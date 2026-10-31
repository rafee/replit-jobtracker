package main

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHealthDoesNotRequireAuthentication(t *testing.T) {
	server := &apiServer{
		auth:   newClerkVerifier("https://example.test/jwks.json", "https://example.test"),
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	handler := server.routes("test-secret")
	request := httptest.NewRequest(http.MethodGet, "/api/healthz", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("health status = %d, want %d", response.Code, http.StatusOK)
	}
	if response.Body.String() != "{\"status\":\"ok\"}\n" {
		t.Fatalf("health body = %q", response.Body.String())
	}
}

func TestAPIRequiresAuthentication(t *testing.T) {
	server := &apiServer{
		auth:   newClerkVerifier("https://example.test/jwks.json", "https://example.test"),
		logger: slog.New(slog.NewTextHandler(io.Discard, nil)),
	}
	handler := server.routes("test-secret")
	request := httptest.NewRequest(http.MethodGet, "/api/profile", nil)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("profile status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
}

func TestValidStatus(t *testing.T) {
	for _, status := range []string{"saved", "applied", "interviewing", "offer", "rejected", "withdrawn"} {
		if !validStatus(status) {
			t.Errorf("validStatus(%q) = false", status)
		}
	}
	for _, status := range []string{"", "pending", "SAVED"} {
		if validStatus(status) {
			t.Errorf("validStatus(%q) = true", status)
		}
	}
}

func TestDecodeJSONRejectsNullForRequiredNonNullableFields(t *testing.T) {
	request := httptest.NewRequest(http.MethodPut, "/api/profile", strings.NewReader(`{"fullName":null}`))
	response := httptest.NewRecorder()
	var input profileInput

	if err := decodeJSON(response, request, &input, "fullName"); err == nil {
		t.Fatal("null string field was accepted")
	}
}

func TestClerkVerifierAcceptsSessionTokenAndRejectsNonSessionToken(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	const keyID = "test-key"
	jwks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		exponent := bigEndian(privateKey.PublicKey.E)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]string{{
				"kid": keyID,
				"kty": "RSA",
				"use": "sig",
				"n":   base64.RawURLEncoding.EncodeToString(privateKey.PublicKey.N.Bytes()),
				"e":   base64.RawURLEncoding.EncodeToString(exponent),
			}},
		})
	}))
	defer jwks.Close()

	verifier := newClerkVerifier(jwks.URL, "https://issuer.example")
	baseClaims := map[string]any{
		"sub": "user_123",
		"sid": "session_123",
		"iss": "https://issuer.example",
		"exp": time.Now().Add(time.Minute).Unix(),
	}
	userID, err := verifier.userID(context.Background(), makeSignedToken(t, privateKey, keyID, baseClaims))
	if err != nil {
		t.Fatalf("valid Clerk session token rejected: %v", err)
	}
	if userID != "user_123" {
		t.Fatalf("user ID = %q, want user_123", userID)
	}

	delete(baseClaims, "sid")
	if _, err := verifier.userID(context.Background(), makeSignedToken(t, privateKey, keyID, baseClaims)); err == nil {
		t.Fatal("token without a Clerk session ID was accepted")
	}
}

func makeSignedToken(t *testing.T, key *rsa.PrivateKey, keyID string, claims map[string]any) string {
	t.Helper()
	header, err := json.Marshal(map[string]string{"alg": "RS256", "kid": keyID})
	if err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	digest := sha256.Sum256([]byte(unsigned))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func bigEndian(value int) []byte {
	var result []byte
	for value > 0 {
		result = append([]byte{byte(value)}, result...)
		value >>= 8
	}
	return result
}
