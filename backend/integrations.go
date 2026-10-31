package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"google.golang.org/genai"
)

type integrations struct {
	httpClient *http.Client
}

type providerError struct {
	status int
}

func (e providerError) Error() string {
	return fmt.Sprintf("TheirStack returned HTTP %d", e.status)
}

func newIntegrations() *integrations {
	return &integrations{
		httpClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func (i *integrations) searchJobs(ctx context.Context, input searchInput) ([]jobSearchResult, int, bool, error) {
	apiKey := strings.TrimSpace(os.Getenv("THEIRSTACK_API_KEY"))
	if apiKey == "" {
		return nil, 0, false, errors.New("TheirStack is not configured. Set THEIRSTACK_API_KEY.")
	}
	filters := map[string]any{
		"posted_at_max_age_days": input.PostedWithinDays,
		"limit":                  input.Limit,
		"page":                   0,
	}
	if title := strings.TrimSpace(input.JobTitle); title != "" {
		filters["job_title_or"] = []string{title}
	}
	if country := strings.TrimSpace(input.CountryCode); country != "" {
		filters["job_country_code_or"] = []string{strings.ToUpper(country)}
	}
	if input.Remote {
		filters["remote"] = true
	}
	if input.MinSalaryUSD != nil {
		filters["min_salary_usd"] = *input.MinSalaryUSD
	}
	if input.MaxSalaryUSD != nil {
		filters["max_salary_usd"] = *input.MaxSalaryUSD
	}
	body, err := json.Marshal(filters)
	if err != nil {
		return nil, 0, false, fmt.Errorf("encode TheirStack request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.theirstack.com/v1/jobs/search", bytes.NewReader(body))
	if err != nil {
		return nil, 0, false, fmt.Errorf("create TheirStack request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := i.httpClient.Do(request)
	if err != nil {
		return nil, 0, false, fmt.Errorf("request TheirStack jobs: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, 0, false, providerError{status: response.StatusCode}
	}
	var payload struct {
		Data     []map[string]any `json:"data"`
		Metadata struct {
			TotalResults     *int `json:"total_results"`
			TruncatedResults bool `json:"truncated_results"`
		} `json:"metadata"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 8<<20)).Decode(&payload); err != nil {
		return nil, 0, false, fmt.Errorf("decode TheirStack response: %w", err)
	}

	locationNeedle := strings.ToLower(strings.TrimSpace(input.Location))
	results := make([]jobSearchResult, 0, len(payload.Data))
	for _, raw := range payload.Data {
		company, _ := raw["company_object"].(map[string]any)
		location := textValue(raw["location"])
		if location == "" {
			location = textValue(raw["job_location"])
		}
		if locationNeedle != "" && !strings.Contains(strings.ToLower(location), locationNeedle) {
			continue
		}
		sourceID := textValue(raw["id"])
		if sourceID == "" {
			sourceID = textValue(raw["url"])
		}
		result := jobSearchResult{
			SourceID:     sourceID,
			Title:        textValue(raw["job_title"]),
			Company:      textValue(company["name"]),
			URL:          textValue(raw["url"]),
			Location:     location,
			Remote:       raw["remote"] == true,
			PostedAt:     parseDate(raw["date_posted"]),
			Seniority:    stringPointer(raw["seniority"]),
			MinSalaryUSD: intPointer(raw["min_annual_salary_usd"]),
			MaxSalaryUSD: intPointer(raw["max_annual_salary_usd"]),
			Description:  truncate(textValue(raw["description"]), 20000),
		}
		if result.Company == "" {
			result.Company = textValue(raw["company_name"])
		}
		if result.Company == "" {
			result.Company = "Company not listed"
		}
		if result.SourceID != "" && result.Title != "" && result.URL != "" {
			results = append(results, result)
		}
	}
	total := len(results)
	if payload.Metadata.TotalResults != nil {
		total = *payload.Metadata.TotalResults
	}
	return results, total, payload.Metadata.TruncatedResults, nil
}

func (i *integrations) generateResume(ctx context.Context, input resumeGenerationInput) (string, error) {
	apiKey := strings.TrimSpace(os.Getenv("GEMINI_API_KEY"))
	if apiKey == "" {
		return "", errors.New("Gemini is not configured. Add GEMINI_API_KEY in Secrets.")
	}
	client, err := genai.NewClient(ctx, &genai.ClientConfig{APIKey: apiKey})
	if err != nil {
		return "", fmt.Errorf("initialize Gemini client: %w", err)
	}

	prompt := strings.Join([]string{
		"Create a tailored resume draft for the candidate and role below.",
		"Use only facts explicitly present in the source resume or profile notes. Never invent employers, dates, degrees, certifications, skills, metrics, or accomplishments.",
		"Keep the candidate's experience truthful. Reorder and emphasize relevant evidence, and make wording clearer without changing facts.",
		"Follow the user's focus prompt where consistent with the source material.",
		"Return only the resume draft text, with clear section headings. Do not include commentary.",
		"Candidate: " + fallback(input.FullName, "Not provided"),
		"User's standing preferences: " + fallback(input.PromptPreferences, "None provided"),
		"User's instructions for this version: " + input.UserPrompt,
		"Target role: " + input.JobTitle + " at " + input.Company,
		"Role description:\n" + input.JobDescription,
		"Source resume:\n" + input.SourceResume,
		"LinkedIn profile notes:\n" + fallback(input.LinkedInNotes, "None provided"),
	}, "\n\n")
	response, err := client.Models.GenerateContent(ctx, "gemini-2.5-flash", genai.Text(prompt), &genai.GenerateContentConfig{
		MaxOutputTokens: 8192,
	})
	if err != nil {
		return "", fmt.Errorf("generate resume with Gemini: %w", err)
	}
	content := strings.TrimSpace(response.Text())
	if content == "" {
		return "", errors.New("Gemini returned an empty resume draft.")
	}
	return content, nil
}

type resumeGenerationInput struct {
	FullName          string
	SourceResume      string
	LinkedInNotes     string
	PromptPreferences string
	UserPrompt        string
	JobTitle          string
	Company           string
	JobDescription    string
}

func textValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case json.Number:
		return typed.String()
	case float64:
		return fmt.Sprintf("%v", typed)
	default:
		return ""
	}
}

func parseDate(value any) *time.Time {
	text, ok := value.(string)
	if !ok || text == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339, text)
	if err != nil {
		return nil
	}
	parsed = parsed.UTC()
	return &parsed
}

func stringPointer(value any) *string {
	text, ok := value.(string)
	if !ok || text == "" {
		return nil
	}
	return &text
}

func intPointer(value any) *int {
	number, ok := value.(float64)
	if !ok {
		return nil
	}
	result := int(number)
	if float64(result) != number {
		return nil
	}
	return &result
}

func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}

func fallback(value, replacement string) string {
	if strings.TrimSpace(value) == "" {
		return replacement
	}
	return value
}
