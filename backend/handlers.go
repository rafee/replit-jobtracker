package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"time"
)

var errNotFound = errors.New("record not found")

type apiServer struct {
	store        *store
	auth         *clerkVerifier
	logger       *slog.Logger
	integrations *integrations
}

func (s *apiServer) routes(clerkSecretKey string) http.Handler {
	s.integrations = newIntegrations()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/healthz", s.health)
	proxy := s.clerkProxy(clerkSecretKey)
	mux.Handle("/api/__clerk", proxy)
	mux.Handle("/api/__clerk/", proxy)

	authenticated := s.auth.middleware(http.HandlerFunc(s.api))
	mux.Handle("/api/", authenticated)
	return s.requestLogger(s.recoverPanics(mux))
}

func (s *apiServer) api(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/profile":
		s.getProfile(w, r)
	case r.Method == http.MethodPut && r.URL.Path == "/api/profile":
		s.saveProfile(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/api/dashboard":
		s.dashboard(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/jobs/search":
		s.searchJobs(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/api/jobs":
		s.listJobs(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/jobs":
		s.saveJob(w, r)
	case r.Method == http.MethodPatch && strings.HasPrefix(r.URL.Path, "/api/jobs/"):
		if strings.HasSuffix(r.URL.Path, "/resume-drafts") {
			http.NotFound(w, r)
			return
		}
		s.updateJob(w, r)
	case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/api/jobs/"):
		s.deleteJob(w, r)
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/jobs/") && strings.HasSuffix(r.URL.Path, "/resume-drafts"):
		s.listDrafts(w, r)
	case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/api/jobs/") && strings.HasSuffix(r.URL.Path, "/resume-drafts"):
		s.createDraft(w, r)
	case r.Method == http.MethodPatch && strings.HasPrefix(r.URL.Path, "/api/resume-drafts/"):
		s.updateDraft(w, r)
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/resume-drafts/") && strings.HasSuffix(r.URL.Path, "/download"):
		s.downloadDraft(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (s *apiServer) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *apiServer) getProfile(w http.ResponseWriter, r *http.Request) {
	value, err := s.store.getProfile(r.Context(), authenticatedUserID(r.Context()))
	if err != nil {
		s.internalError(w, r, "get profile", err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (s *apiServer) saveProfile(w http.ResponseWriter, r *http.Request) {
	var input profileInput
	if err := decodeJSON(w, r, &input,
		"fullName", "baseResume", "linkedinNotes", "targetTitles", "location",
		"countryCode", "remoteOnly", "minSalaryUsd", "maxSalaryUsd", "promptPreferences",
	); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(input.FullName) > 200 || len(input.BaseResume) > 50000 ||
		len(input.LinkedInNotes) > 20000 || len(input.TargetTitles) > 20 ||
		len(input.Location) > 200 || len(input.CountryCode) != 2 ||
		len(input.PromptPreferences) > 4000 || input.TargetTitles == nil {
		writeError(w, http.StatusBadRequest, "Invalid profile values.")
		return
	}
	for _, title := range input.TargetTitles {
		if len(title) > 120 {
			writeError(w, http.StatusBadRequest, "Invalid profile values.")
			return
		}
	}
	if !validSalary(input.MinSalaryUSD) || !validSalary(input.MaxSalaryUSD) {
		writeError(w, http.StatusBadRequest, "Invalid salary values.")
		return
	}
	value, err := s.store.saveProfile(r.Context(), authenticatedUserID(r.Context()), input)
	if err != nil {
		s.internalError(w, r, "save profile", err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (s *apiServer) dashboard(w http.ResponseWriter, r *http.Request) {
	jobs, err := s.store.listRecentJobs(r.Context(), authenticatedUserID(r.Context()), 50)
	if err != nil {
		s.internalError(w, r, "get dashboard", err)
		return
	}
	summary := map[string]any{
		"saved":        0,
		"applied":      0,
		"interviewing": 0,
		"offers":       0,
		"recentJobs":   jobs[:min(6, len(jobs))],
	}
	for _, job := range jobs {
		switch job.Status {
		case "saved":
			summary["saved"] = summary["saved"].(int) + 1
		case "applied":
			summary["applied"] = summary["applied"].(int) + 1
		case "interviewing":
			summary["interviewing"] = summary["interviewing"].(int) + 1
		case "offer":
			summary["offers"] = summary["offers"].(int) + 1
		}
	}
	writeJSON(w, http.StatusOK, summary)
}

func (s *apiServer) searchJobs(w http.ResponseWriter, r *http.Request) {
	var input searchInput
	if err := decodeJSON(w, r, &input, "jobTitle", "location", "countryCode", "remote", "postedWithinDays", "limit"); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(input.JobTitle) > 180 || len(input.Location) > 200 ||
		len(input.CountryCode) != 2 || input.PostedWithinDays < 1 ||
		input.PostedWithinDays > 90 || input.Limit < 1 || input.Limit > 25 ||
		!validSalary(input.MinSalaryUSD) || !validSalary(input.MaxSalaryUSD) {
		writeError(w, http.StatusBadRequest, "Invalid job search criteria.")
		return
	}
	results, total, truncated, err := s.integrations.searchJobs(r.Context(), input)
	if err != nil {
		s.logger.Error("job search integration failed", "error", err, "userId", authenticatedUserID(r.Context()))
		message := "The job-search service is unavailable."
		var upstreamErr providerError
		if errors.As(err, &upstreamErr) {
			switch upstreamErr.status {
			case http.StatusPaymentRequired:
				message = "The connected job-search service has no remaining search credits."
			case http.StatusTooManyRequests:
				message = "The job-search service is rate-limiting requests. Try again shortly."
			case http.StatusUnauthorized:
				message = "The job-search connection needs to be reconnected."
			default:
				message = "The job-search service could not complete this search."
			}
		} else if strings.Contains(err.Error(), "not configured") {
			message = "The connected job-search service is not configured."
		}
		writeError(w, http.StatusBadGateway, message)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"results":   results,
		"total":     total,
		"truncated": truncated,
	})
}

func (s *apiServer) listJobs(w http.ResponseWriter, r *http.Request) {
	filterStatus := r.URL.Query().Get("status")
	if filterStatus != "" && !validStatus(filterStatus) {
		writeError(w, http.StatusBadRequest, "Invalid job status.")
		return
	}
	jobs, err := s.store.listJobs(r.Context(), authenticatedUserID(r.Context()), filterStatus)
	if err != nil {
		s.internalError(w, r, "list jobs", err)
		return
	}
	writeJSON(w, http.StatusOK, jobs)
}

func (s *apiServer) saveJob(w http.ResponseWriter, r *http.Request) {
	var input jobInput
	if err := decodeJSON(w, r, &input,
		"sourceId", "title", "company", "url", "location", "remote",
		"postedAt", "seniority", "minSalaryUsd", "maxSalaryUsd", "description",
	); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(input.SourceID) > 180 || len(input.Title) > 300 ||
		len(input.Company) > 300 || len(input.Location) > 300 ||
		!validSalary(input.MinSalaryUSD) || !validSalary(input.MaxSalaryUSD) {
		writeError(w, http.StatusBadRequest, "Invalid job values.")
		return
	}
	if parsed, err := url.ParseRequestURI(input.URL); err != nil || parsed.Scheme == "" || parsed.Host == "" {
		writeError(w, http.StatusBadRequest, "Job URL must be a valid absolute URL.")
		return
	}
	value, err := s.store.saveJob(r.Context(), authenticatedUserID(r.Context()), input)
	if err != nil {
		s.internalError(w, r, "save job", err)
		return
	}
	writeJSON(w, http.StatusCreated, value)
}

func (s *apiServer) updateJob(w http.ResponseWriter, r *http.Request) {
	jobID, ok := routeID(w, r, "/api/jobs/", "")
	if !ok {
		return
	}
	var input jobUpdateInput
	if err := decodeJSON(w, r, &input, "status", "notes"); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !validStatus(input.Status) || len(input.Notes) > 5000 {
		writeError(w, http.StatusBadRequest, "Invalid job update.")
		return
	}
	value, err := s.store.updateJob(r.Context(), authenticatedUserID(r.Context()), jobID, input)
	if errors.Is(err, errNotFound) {
		writeError(w, http.StatusNotFound, "Tracked job not found.")
		return
	}
	if err != nil {
		s.internalError(w, r, "update job", err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (s *apiServer) deleteJob(w http.ResponseWriter, r *http.Request) {
	jobID, ok := routeID(w, r, "/api/jobs/", "")
	if !ok {
		return
	}
	err := s.store.deleteJob(r.Context(), authenticatedUserID(r.Context()), jobID)
	if errors.Is(err, errNotFound) {
		writeError(w, http.StatusNotFound, "Tracked job not found.")
		return
	}
	if err != nil {
		s.internalError(w, r, "delete job", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *apiServer) listDrafts(w http.ResponseWriter, r *http.Request) {
	jobID, ok := routeID(w, r, "/api/jobs/", "/resume-drafts")
	if !ok {
		return
	}
	if _, err := s.store.getJob(r.Context(), authenticatedUserID(r.Context()), jobID); errors.Is(err, errNotFound) {
		writeJSON(w, http.StatusOK, []resumeDraft{})
		return
	} else if err != nil {
		s.internalError(w, r, "check job for resume drafts", err)
		return
	}
	drafts, err := s.store.listDrafts(r.Context(), authenticatedUserID(r.Context()), jobID)
	if err != nil {
		s.internalError(w, r, "list resume drafts", err)
		return
	}
	writeJSON(w, http.StatusOK, drafts)
}

func (s *apiServer) createDraft(w http.ResponseWriter, r *http.Request) {
	jobID, ok := routeID(w, r, "/api/jobs/", "/resume-drafts")
	if !ok {
		return
	}
	var input resumeDraftInput
	if err := decodeJSON(w, r, &input, "prompt"); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(input.Prompt) > 4000 {
		writeError(w, http.StatusBadRequest, "Resume prompt must be 4000 characters or fewer.")
		return
	}
	userID := authenticatedUserID(r.Context())
	job, err := s.store.getJob(r.Context(), userID, jobID)
	if errors.Is(err, errNotFound) {
		writeError(w, http.StatusNotFound, "Tracked job not found.")
		return
	}
	if err != nil {
		s.internalError(w, r, "get job for resume generation", err)
		return
	}
	candidate, err := s.store.getProfile(r.Context(), userID)
	if err != nil {
		s.internalError(w, r, "get profile for resume generation", err)
		return
	}
	if strings.TrimSpace(candidate.BaseResume) == "" {
		writeError(w, http.StatusBadRequest, "Add your source resume in Profile before creating a tailored draft.")
		return
	}
	content, err := s.integrations.generateResume(r.Context(), resumeGenerationInput{
		FullName:          candidate.FullName,
		SourceResume:      candidate.BaseResume,
		LinkedInNotes:     candidate.LinkedInNotes,
		PromptPreferences: candidate.PromptPreferences,
		UserPrompt:        input.Prompt,
		JobTitle:          job.Title,
		Company:           job.Company,
		JobDescription:    job.Description,
	})
	if err != nil {
		s.logger.Error("resume generation failed", "error", err, "userId", userID, "jobId", jobID)
		message := "Gemini could not create a resume draft. Try again in a moment."
		if strings.Contains(err.Error(), "Gemini is not configured") {
			message = "Gemini is not configured. Add GEMINI_API_KEY in Secrets."
		}
		writeError(w, http.StatusBadGateway, message)
		return
	}
	draft, err := s.store.createDraft(r.Context(), userID, jobID, input.Prompt, content)
	if err != nil {
		s.internalError(w, r, "save generated resume draft", err)
		return
	}
	writeJSON(w, http.StatusCreated, draft)
}

func (s *apiServer) updateDraft(w http.ResponseWriter, r *http.Request) {
	draftID, ok := routeID(w, r, "/api/resume-drafts/", "")
	if !ok {
		return
	}
	var input resumeDraftUpdateInput
	if err := decodeJSON(w, r, &input, "content"); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(input.Content) == 0 || len(input.Content) > 50000 {
		writeError(w, http.StatusBadRequest, "Resume content must be between 1 and 50000 characters.")
		return
	}
	value, err := s.store.updateDraft(r.Context(), authenticatedUserID(r.Context()), draftID, input.Content)
	if errors.Is(err, errNotFound) {
		writeError(w, http.StatusNotFound, "Resume draft not found.")
		return
	}
	if err != nil {
		s.internalError(w, r, "update resume draft", err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (s *apiServer) downloadDraft(w http.ResponseWriter, r *http.Request) {
	draftID, ok := routeID(w, r, "/api/resume-drafts/", "/download")
	if !ok {
		return
	}
	value, err := s.store.getDraft(r.Context(), authenticatedUserID(r.Context()), draftID)
	if errors.Is(err, errNotFound) {
		writeError(w, http.StatusNotFound, "Resume draft not found.")
		return
	}
	if err != nil {
		s.internalError(w, r, "download resume draft", err)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="tailored-resume.txt"`)
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, value.Content)
}

func (s *apiServer) internalError(w http.ResponseWriter, r *http.Request, operation string, err error) {
	s.logger.Error(operation, "error", err, "userId", authenticatedUserID(r.Context()))
	writeError(w, http.StatusInternalServerError, "Internal server error.")
}

func (s *apiServer) recoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				s.logger.Error("request panic", "panic", recovered, "path", r.URL.Path)
				writeError(w, http.StatusInternalServerError, "Internal server error.")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type responseRecorder struct {
	http.ResponseWriter
	status int
}

func (w *responseRecorder) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (s *apiServer) requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recorder := &responseRecorder{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()
		next.ServeHTTP(recorder, r)
		s.logger.Info("http request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", recorder.status,
			"durationMs", time.Since(start).Milliseconds(),
		)
	})
}

func routeID(w http.ResponseWriter, r *http.Request, prefix, suffix string) (int64, bool) {
	if !strings.HasPrefix(r.URL.Path, prefix) || (suffix != "" && !strings.HasSuffix(r.URL.Path, suffix)) {
		http.NotFound(w, r)
		return 0, false
	}
	raw := strings.TrimPrefix(r.URL.Path, prefix)
	raw = strings.TrimSuffix(raw, suffix)
	if raw == "" || strings.Contains(raw, "/") {
		http.NotFound(w, r)
		return 0, false
	}
	id, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid identifier.")
		return 0, false
	}
	return id, true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any, required ...string) error {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return errors.New("Invalid request body.")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil || fields == nil {
		return errors.New("Invalid request body.")
	}
	for _, name := range required {
		if _, ok := fields[name]; !ok {
			return fmt.Errorf("Missing required field: %s.", name)
		}
	}
	targetType := reflect.TypeOf(target)
	if targetType == nil || targetType.Kind() != reflect.Pointer || targetType.Elem().Kind() != reflect.Struct {
		return errors.New("Invalid request body.")
	}
	structType := targetType.Elem()
	for name, raw := range fields {
		fieldType, ok := jsonFieldType(structType, name)
		if ok && fieldType.Kind() != reflect.Pointer && bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return fmt.Errorf("Field %s cannot be null.", name)
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	if err := decoder.Decode(target); err != nil {
		return errors.New("Invalid request body.")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("Invalid request body.")
	}
	return nil
}

func jsonFieldType(structType reflect.Type, jsonName string) (reflect.Type, bool) {
	for index := 0; index < structType.NumField(); index++ {
		field := structType.Field(index)
		name := strings.Split(field.Tag.Get("json"), ",")[0]
		if name == "" {
			name = field.Name
		}
		if name == jsonName {
			return field.Type, true
		}
	}
	return nil, false
}

func validSalary(value *int) bool {
	return value == nil || (*value >= 0 && int64(*value) <= 2147483647)
}

func validStatus(status string) bool {
	switch status {
	case "saved", "applied", "interviewing", "offer", "rejected", "withdrawn":
		return true
	default:
		return false
	}
}

func writeJSON(w http.ResponseWriter, statusCode int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Error("write JSON response", "error", err)
	}
}

func writeError(w http.ResponseWriter, statusCode int, message string) {
	writeJSON(w, statusCode, map[string]string{"error": message})
}

func (s *apiServer) clerkProxy(secretKey string) http.Handler {
	client := &http.Client{Timeout: 60 * time.Second}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/__clerk")
		upstreamURL := "https://frontend-api.clerk.dev" + path
		if r.URL.RawQuery != "" {
			upstreamURL += "?" + r.URL.RawQuery
		}

		request, err := http.NewRequestWithContext(r.Context(), r.Method, upstreamURL, r.Body)
		if err != nil {
			s.logger.Error("create Clerk proxy request", "error", err)
			writeError(w, http.StatusBadGateway, "Authentication service is unavailable.")
			return
		}
		request.Header = r.Header.Clone()
		request.Header.Del("Host")
		request.Header.Set("Clerk-Secret-Key", secretKey)
		request.Header.Set("Clerk-Proxy-Url", forwardedScheme(r)+"://"+forwardedHost(r)+"/api/__clerk")
		if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
			request.Header.Set("X-Forwarded-For", strings.TrimSpace(strings.Split(forwarded, ",")[0]))
		}
		response, err := client.Do(request)
		if err != nil {
			s.logger.Error("forward Clerk proxy request", "error", err)
			writeError(w, http.StatusBadGateway, "Authentication service is unavailable.")
			return
		}
		defer response.Body.Close()
		for key, values := range response.Header {
			if isHopByHopHeader(key) {
				continue
			}
			for _, value := range values {
				w.Header().Add(key, value)
			}
		}
		w.WriteHeader(response.StatusCode)
		if _, err := io.Copy(w, response.Body); err != nil {
			s.logger.Warn("copy Clerk proxy response", "error", err)
		}
	})
}

func forwardedHost(r *http.Request) string {
	if host := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Host"), ",")[0]); host != "" {
		return host
	}
	return r.Host
}

func forwardedScheme(r *http.Request) string {
	if scheme := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]); scheme != "" {
		return scheme
	}
	if r.TLS != nil {
		return "https"
	}
	return "http"
}

func isHopByHopHeader(name string) bool {
	switch strings.ToLower(name) {
	case "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade":
		return true
	default:
		return false
	}
}
