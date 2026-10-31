package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"cloud.google.com/go/firestore"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	projectID := strings.TrimSpace(os.Getenv("FIREBASE_PROJECT_ID"))
	if projectID == "" {
		projectID = strings.TrimSpace(os.Getenv("GOOGLE_CLOUD_PROJECT"))
	}
	if projectID == "" {
		logger.Error("FIREBASE_PROJECT_ID or GOOGLE_CLOUD_PROJECT must be set")
		os.Exit(1)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	client, err := firestore.NewClient(ctx, projectID)
	if err != nil {
		logger.Error("initialize Firestore", "error", err)
		os.Exit(1)
	}
	defer func() {
		if err := client.Close(); err != nil {
			logger.Error("close Firestore client", "error", err)
		}
	}()

	jwksURL := strings.TrimSpace(os.Getenv("CLERK_JWKS_URL"))
	issuer := strings.TrimRight(strings.TrimSpace(os.Getenv("CLERK_ISSUER")), "/")
	secretKey := strings.TrimSpace(os.Getenv("CLERK_SECRET_KEY"))
	jwksAddress, jwksErr := url.Parse(jwksURL)
	issuerAddress, issuerErr := url.Parse(issuer)
	if jwksErr != nil || jwksAddress.Scheme != "https" || jwksAddress.Host == "" ||
		issuerErr != nil || issuerAddress.Scheme != "https" || issuerAddress.Host == "" {
		logger.Error("CLERK_JWKS_URL and CLERK_ISSUER must be valid HTTPS URLs")
		os.Exit(1)
	}
	if secretKey == "" {
		logger.Error("CLERK_SECRET_KEY must be set")
		os.Exit(1)
	}

	server := &apiServer{
		store:  &store{client: client},
		auth:   newClerkVerifier(jwksURL, issuer),
		logger: logger,
	}

	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8080"
	}
	httpServer := &http.Server{
		Addr:              ":" + port,
		Handler:           server.routes(secretKey),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      5 * time.Minute,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		logger.Info("starting API server", "port", port)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("API server failed", "error", err)
			cancel()
		}
	}()

	<-ctx.Done()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		logger.Error("shut down API server", "error", err)
	}
}
