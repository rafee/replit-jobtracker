package main

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

type jwkSet struct {
	Keys []struct {
		KeyID string `json:"kid"`
		Type  string `json:"kty"`
		Use   string `json:"use"`
		N     string `json:"n"`
		E     string `json:"e"`
	} `json:"keys"`
}

type clerkVerifier struct {
	jwksURL string
	issuer  string
	client  *http.Client
	mu      sync.Mutex
	keys    map[string]*rsa.PublicKey
	fetched time.Time
}

func newClerkVerifier(jwksURL, issuer string) *clerkVerifier {
	return &clerkVerifier{
		jwksURL: strings.TrimSpace(jwksURL),
		issuer:  strings.TrimRight(strings.TrimSpace(issuer), "/"),
		client:  &http.Client{Timeout: 5 * time.Second},
	}
}

func (v *clerkVerifier) userID(ctx context.Context, token string) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", errors.New("malformed session token")
	}
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return "", errors.New("malformed session header")
	}
	var header struct {
		Algorithm string `json:"alg"`
		KeyID     string `json:"kid"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil || header.Algorithm != "RS256" || header.KeyID == "" {
		return "", errors.New("unsupported session token")
	}
	key, err := v.publicKey(ctx, header.KeyID)
	if err != nil {
		return "", err
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return "", errors.New("malformed session signature")
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature); err != nil {
		return "", errors.New("invalid session signature")
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", errors.New("malformed session payload")
	}
	var claims struct {
		Subject   string `json:"sub"`
		SessionID string `json:"sid"`
		Issuer    string `json:"iss"`
		ExpiresAt int64  `json:"exp"`
		NotBefore int64  `json:"nbf"`
	}
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return "", errors.New("malformed session claims")
	}
	now := time.Now().Unix()
	if claims.Subject == "" || claims.SessionID == "" ||
		claims.Issuer != v.issuer || claims.ExpiresAt <= now {
		return "", errors.New("expired or invalid session claims")
	}
	if claims.NotBefore != 0 && claims.NotBefore > now {
		return "", errors.New("session is not yet valid")
	}
	return claims.Subject, nil
}

func (v *clerkVerifier) publicKey(ctx context.Context, keyID string) (*rsa.PublicKey, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if !v.fetched.IsZero() && time.Since(v.fetched) < time.Hour {
		if key := v.keys[keyID]; key != nil {
			return key, nil
		}
		if time.Since(v.fetched) < time.Minute {
			return nil, errors.New("session signing key was not found in Clerk JWKS")
		}
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, v.jwksURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create Clerk JWKS request: %w", err)
	}
	response, err := v.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("fetch Clerk JWKS: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch Clerk JWKS: HTTP %d", response.StatusCode)
	}
	var set jwkSet
	if err := json.NewDecoder(http.MaxBytesReader(nil, response.Body, 1<<20)).Decode(&set); err != nil {
		return nil, fmt.Errorf("decode Clerk JWKS: %w", err)
	}
	keys := make(map[string]*rsa.PublicKey, len(set.Keys))
	for _, jwk := range set.Keys {
		if jwk.Type != "RSA" || jwk.KeyID == "" {
			continue
		}
		modulus, err := base64.RawURLEncoding.DecodeString(jwk.N)
		if err != nil {
			continue
		}
		exponentBytes, err := base64.RawURLEncoding.DecodeString(jwk.E)
		if err != nil || len(exponentBytes) == 0 || len(exponentBytes) > 4 {
			continue
		}
		exponent := 0
		for _, b := range exponentBytes {
			exponent = exponent<<8 | int(b)
		}
		if exponent < 3 || exponent%2 == 0 {
			continue
		}
		keys[jwk.KeyID] = &rsa.PublicKey{N: new(big.Int).SetBytes(modulus), E: exponent}
	}
	if len(keys) == 0 {
		return nil, errors.New("Clerk JWKS contains no usable RSA keys")
	}
	v.keys = keys
	v.fetched = time.Now()
	if key := v.keys[keyID]; key != nil {
		return key, nil
	}
	return nil, errors.New("session signing key was not found in Clerk JWKS")
}

func (v *clerkVerifier) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := ""
		if authorization := r.Header.Get("Authorization"); strings.HasPrefix(authorization, "Bearer ") {
			token = strings.TrimSpace(strings.TrimPrefix(authorization, "Bearer "))
		}
		if token == "" {
			if cookie, err := r.Cookie("__session"); err == nil {
				token = cookie.Value
			}
		}
		if token == "" {
			writeError(w, http.StatusUnauthorized, "Unauthorized")
			return
		}

		userID, err := v.userID(r.Context(), token)
		if err != nil {
			if strings.Contains(err.Error(), "fetch Clerk JWKS") {
				writeError(w, http.StatusServiceUnavailable, "Authentication service is temporarily unavailable.")
			} else {
				writeError(w, http.StatusUnauthorized, "Unauthorized")
			}
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userIDContextKey{}, userID)))
	})
}

type userIDContextKey struct{}

func authenticatedUserID(ctx context.Context) string {
	userID, _ := ctx.Value(userIDContextKey{}).(string)
	return userID
}
