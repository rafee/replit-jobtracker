package main

import "time"

type profile struct {
	UserID            string    `json:"-" firestore:"userId"`
	FullName          string    `json:"fullName" firestore:"fullName"`
	BaseResume        string    `json:"baseResume" firestore:"baseResume"`
	LinkedInNotes     string    `json:"linkedinNotes" firestore:"linkedinNotes"`
	TargetTitles      []string  `json:"targetTitles" firestore:"targetTitles"`
	Location          string    `json:"location" firestore:"location"`
	CountryCode       string    `json:"countryCode" firestore:"countryCode"`
	RemoteOnly        bool      `json:"remoteOnly" firestore:"remoteOnly"`
	MinSalaryUSD      *int      `json:"minSalaryUsd" firestore:"minSalaryUsd"`
	MaxSalaryUSD      *int      `json:"maxSalaryUsd" firestore:"maxSalaryUsd"`
	PromptPreferences string    `json:"promptPreferences" firestore:"promptPreferences"`
	UpdatedAt         time.Time `json:"updatedAt" firestore:"updatedAt"`
}

type trackedJob struct {
	ID           int64      `json:"id" firestore:"id"`
	UserID       string     `json:"-" firestore:"userId"`
	SourceID     string     `json:"sourceId" firestore:"sourceId"`
	Title        string     `json:"title" firestore:"title"`
	Company      string     `json:"company" firestore:"company"`
	URL          string     `json:"url" firestore:"url"`
	Location     string     `json:"location" firestore:"location"`
	Remote       bool       `json:"remote" firestore:"remote"`
	PostedAt     *time.Time `json:"postedAt" firestore:"postedAt"`
	Seniority    *string    `json:"seniority" firestore:"seniority"`
	MinSalaryUSD *int       `json:"minSalaryUsd" firestore:"minSalaryUsd"`
	MaxSalaryUSD *int       `json:"maxSalaryUsd" firestore:"maxSalaryUsd"`
	Description  string     `json:"description" firestore:"description"`
	Status       string     `json:"status" firestore:"status"`
	Notes        string     `json:"notes" firestore:"notes"`
	CreatedAt    time.Time  `json:"createdAt" firestore:"createdAt"`
	UpdatedAt    time.Time  `json:"updatedAt" firestore:"updatedAt"`
}

type resumeDraft struct {
	ID        int64     `json:"id" firestore:"id"`
	UserID    string    `json:"-" firestore:"userId"`
	JobID     int64     `json:"jobId" firestore:"jobId"`
	Prompt    string    `json:"prompt" firestore:"prompt"`
	Content   string    `json:"content" firestore:"content"`
	CreatedAt time.Time `json:"createdAt" firestore:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt" firestore:"updatedAt"`
}

type profileInput struct {
	FullName          string   `json:"fullName"`
	BaseResume        string   `json:"baseResume"`
	LinkedInNotes     string   `json:"linkedinNotes"`
	TargetTitles      []string `json:"targetTitles"`
	Location          string   `json:"location"`
	CountryCode       string   `json:"countryCode"`
	RemoteOnly        bool     `json:"remoteOnly"`
	MinSalaryUSD      *int     `json:"minSalaryUsd"`
	MaxSalaryUSD      *int     `json:"maxSalaryUsd"`
	PromptPreferences string   `json:"promptPreferences"`
}

type jobInput struct {
	SourceID     string     `json:"sourceId"`
	Title        string     `json:"title"`
	Company      string     `json:"company"`
	URL          string     `json:"url"`
	Location     string     `json:"location"`
	Remote       bool       `json:"remote"`
	PostedAt     *time.Time `json:"postedAt"`
	Seniority    *string    `json:"seniority"`
	MinSalaryUSD *int       `json:"minSalaryUsd"`
	MaxSalaryUSD *int       `json:"maxSalaryUsd"`
	Description  string     `json:"description"`
}

type jobUpdateInput struct {
	Status string `json:"status"`
	Notes  string `json:"notes"`
}

type searchInput struct {
	JobTitle         string `json:"jobTitle"`
	Location         string `json:"location"`
	CountryCode      string `json:"countryCode"`
	Remote           bool   `json:"remote"`
	PostedWithinDays int    `json:"postedWithinDays"`
	Limit            int    `json:"limit"`
	MinSalaryUSD     *int   `json:"minSalaryUsd"`
	MaxSalaryUSD     *int   `json:"maxSalaryUsd"`
}

type jobSearchResult struct {
	SourceID     string     `json:"sourceId"`
	Title        string     `json:"title"`
	Company      string     `json:"company"`
	URL          string     `json:"url"`
	Location     string     `json:"location"`
	Remote       bool       `json:"remote"`
	PostedAt     *time.Time `json:"postedAt"`
	Seniority    *string    `json:"seniority"`
	MinSalaryUSD *int       `json:"minSalaryUsd"`
	MaxSalaryUSD *int       `json:"maxSalaryUsd"`
	Description  string     `json:"description"`
}

type resumeDraftInput struct {
	Prompt string `json:"prompt"`
}

type resumeDraftUpdateInput struct {
	Content string `json:"content"`
}
