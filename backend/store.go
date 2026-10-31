package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type store struct {
	client *firestore.Client
}

func userKey(userID string) string {
	sum := sha256.Sum256([]byte(userID))
	return hex.EncodeToString(sum[:])
}

func sourceKey(sourceID string) string {
	sum := sha256.Sum256([]byte(sourceID))
	return hex.EncodeToString(sum[:])
}

func (s *store) userRef(userID string) *firestore.DocumentRef {
	return s.client.Collection("users").Doc(userKey(userID))
}

func (s *store) profileRef(userID string) *firestore.DocumentRef {
	return s.client.Collection("profiles").Doc(userKey(userID))
}

func (s *store) jobRef(userID string, jobID int64) *firestore.DocumentRef {
	return s.userRef(userID).Collection("jobs").Doc(strconv.FormatInt(jobID, 10))
}

func (s *store) draftRef(userID string, draftID int64) *firestore.DocumentRef {
	return s.userRef(userID).Collection("drafts").Doc(strconv.FormatInt(draftID, 10))
}

func (s *store) getProfile(ctx context.Context, userID string) (profile, error) {
	ref := s.profileRef(userID)
	var value profile
	snapshot, err := ref.Get(ctx)
	if err == nil {
		if err := snapshot.DataTo(&value); err != nil {
			return profile{}, fmt.Errorf("decode profile: %w", err)
		}
	} else if status.Code(err) == codes.NotFound {
		value = profile{
			UserID:       userID,
			TargetTitles: []string{},
			CountryCode:  "US",
			UpdatedAt:    time.Now().UTC(),
		}
		err = s.client.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
			snapshot, err := tx.Get(ref)
			if err == nil {
				if err := snapshot.DataTo(&value); err != nil {
					return fmt.Errorf("decode profile: %w", err)
				}
				return nil
			}
			if status.Code(err) != codes.NotFound {
				return fmt.Errorf("get profile: %w", err)
			}
			return tx.Set(ref, value)
		})
		if err != nil {
			return profile{}, fmt.Errorf("create default profile: %w", err)
		}
	} else {
		return profile{}, fmt.Errorf("get profile: %w", err)
	}
	if value.TargetTitles == nil {
		value.TargetTitles = []string{}
	}
	return value, nil
}

func (s *store) saveProfile(ctx context.Context, userID string, input profileInput) (profile, error) {
	value := profile{
		UserID:            userID,
		FullName:          input.FullName,
		BaseResume:        input.BaseResume,
		LinkedInNotes:     input.LinkedInNotes,
		TargetTitles:      input.TargetTitles,
		Location:          input.Location,
		CountryCode:       input.CountryCode,
		RemoteOnly:        input.RemoteOnly,
		MinSalaryUSD:      input.MinSalaryUSD,
		MaxSalaryUSD:      input.MaxSalaryUSD,
		PromptPreferences: input.PromptPreferences,
		UpdatedAt:         time.Now().UTC(),
	}
	if value.TargetTitles == nil {
		value.TargetTitles = []string{}
	}
	if _, err := s.profileRef(userID).Set(ctx, value); err != nil {
		return profile{}, fmt.Errorf("save profile: %w", err)
	}
	return value, nil
}

func (s *store) saveJob(ctx context.Context, userID string, input jobInput) (trackedJob, error) {
	now := time.Now().UTC()
	sourceRef := s.userRef(userID).Collection("sourceJobs").Doc(sourceKey(input.SourceID))
	var saved trackedJob
	err := s.client.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		var existing trackedJob
		sourceSnapshot, err := tx.Get(sourceRef)
		if err != nil && status.Code(err) != codes.NotFound {
			return fmt.Errorf("read source mapping: %w", err)
		}
		if err == nil {
			var mapping struct {
				JobID int64 `firestore:"jobId"`
			}
			if err := sourceSnapshot.DataTo(&mapping); err != nil {
				return fmt.Errorf("decode source mapping: %w", err)
			}
			jobSnapshot, err := tx.Get(s.jobRef(userID, mapping.JobID))
			if err != nil {
				return fmt.Errorf("read existing job: %w", err)
			}
			if err := jobSnapshot.DataTo(&existing); err != nil {
				return fmt.Errorf("decode existing job: %w", err)
			}
			existing.SourceID = input.SourceID
			existing.Title = input.Title
			existing.Company = input.Company
			existing.URL = input.URL
			existing.Location = input.Location
			existing.Remote = input.Remote
			existing.PostedAt = input.PostedAt
			existing.Seniority = input.Seniority
			existing.MinSalaryUSD = input.MinSalaryUSD
			existing.MaxSalaryUSD = input.MaxSalaryUSD
			existing.Description = input.Description
			existing.UpdatedAt = now
			saved = existing
			return tx.Set(s.jobRef(userID, existing.ID), existing)
		}

		userRef := s.userRef(userID)
		userSnapshot, err := tx.Get(userRef)
		nextID := int64(1)
		if err != nil && status.Code(err) != codes.NotFound {
			return fmt.Errorf("read user counter: %w", err)
		}
		if err == nil {
			if value, ok := userSnapshot.Data()["nextJobID"].(int64); ok {
				nextID = value + 1
			} else if value, ok := userSnapshot.Data()["nextJobID"].(float64); ok {
				nextID = int64(value) + 1
			}
		}
		saved = trackedJob{
			ID:           nextID,
			UserID:       userID,
			SourceID:     input.SourceID,
			Title:        input.Title,
			Company:      input.Company,
			URL:          input.URL,
			Location:     input.Location,
			Remote:       input.Remote,
			PostedAt:     input.PostedAt,
			Seniority:    input.Seniority,
			MinSalaryUSD: input.MinSalaryUSD,
			MaxSalaryUSD: input.MaxSalaryUSD,
			Description:  input.Description,
			Status:       "saved",
			Notes:        "",
			CreatedAt:    now,
			UpdatedAt:    now,
		}
		if err := tx.Set(userRef, map[string]any{"nextJobID": nextID}, firestore.MergeAll); err != nil {
			return fmt.Errorf("update job counter: %w", err)
		}
		if err := tx.Set(s.jobRef(userID, nextID), saved); err != nil {
			return fmt.Errorf("write job: %w", err)
		}
		return tx.Set(sourceRef, map[string]any{"jobId": nextID})
	})
	if err != nil {
		return trackedJob{}, fmt.Errorf("save job transaction: %w", err)
	}
	return saved, nil
}

func (s *store) listJobs(ctx context.Context, userID string, filterStatus string) ([]trackedJob, error) {
	return readJobs(s.userRef(userID).Collection("jobs").Documents(ctx), filterStatus)
}

func (s *store) listRecentJobs(ctx context.Context, userID string, limit int) ([]trackedJob, error) {
	query := s.userRef(userID).Collection("jobs").OrderBy("updatedAt", firestore.Desc).Limit(limit)
	return readJobs(query.Documents(ctx), "")
}

func readJobs(iter *firestore.DocumentIterator, filterStatus string) ([]trackedJob, error) {
	defer iter.Stop()
	jobs := make([]trackedJob, 0)
	for {
		snapshot, err := iter.Next()
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("list jobs: %w", err)
		}
		var value trackedJob
		if err := snapshot.DataTo(&value); err != nil {
			return nil, fmt.Errorf("decode job: %w", err)
		}
		if filterStatus == "" || value.Status == filterStatus {
			jobs = append(jobs, value)
		}
	}
	sort.Slice(jobs, func(i, j int) bool {
		return jobs[i].UpdatedAt.After(jobs[j].UpdatedAt)
	})
	return jobs, nil
}

func (s *store) getJob(ctx context.Context, userID string, jobID int64) (trackedJob, error) {
	snapshot, err := s.jobRef(userID, jobID).Get(ctx)
	if status.Code(err) == codes.NotFound {
		return trackedJob{}, errNotFound
	}
	if err != nil {
		return trackedJob{}, fmt.Errorf("get job: %w", err)
	}
	var value trackedJob
	if err := snapshot.DataTo(&value); err != nil {
		return trackedJob{}, fmt.Errorf("decode job: %w", err)
	}
	return value, nil
}

func (s *store) updateJob(ctx context.Context, userID string, jobID int64, input jobUpdateInput) (trackedJob, error) {
	ref := s.jobRef(userID, jobID)
	value, err := s.getJob(ctx, userID, jobID)
	if err != nil {
		return trackedJob{}, err
	}
	value.Status = input.Status
	value.Notes = input.Notes
	value.UpdatedAt = time.Now().UTC()
	if _, err := ref.Set(ctx, value); err != nil {
		return trackedJob{}, fmt.Errorf("update job: %w", err)
	}
	return value, nil
}

func (s *store) deleteJob(ctx context.Context, userID string, jobID int64) error {
	ref := s.jobRef(userID, jobID)
	snapshot, err := ref.Get(ctx)
	if status.Code(err) == codes.NotFound {
		return errNotFound
	} else if err != nil {
		return fmt.Errorf("check job before deletion: %w", err)
	}
	var job trackedJob
	if err := snapshot.DataTo(&job); err != nil {
		return fmt.Errorf("decode job before deletion: %w", err)
	}

	drafts := s.userRef(userID).Collection("drafts").Where("jobId", "==", jobID).Documents(ctx)
	defer drafts.Stop()
	batch := s.client.Batch()
	count := 0
	for {
		snapshot, err := drafts.Next()
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return fmt.Errorf("list drafts for job deletion: %w", err)
		}
		batch.Delete(snapshot.Ref)
		count++
		if count == 450 {
			if _, err := batch.Commit(ctx); err != nil {
				return fmt.Errorf("delete job drafts: %w", err)
			}
			batch = s.client.Batch()
			count = 0
		}
	}
	batch.Delete(ref)
	batch.Delete(s.userRef(userID).Collection("sourceJobs").Doc(sourceKey(job.SourceID)))
	if _, err := batch.Commit(ctx); err != nil {
		return fmt.Errorf("delete job: %w", err)
	}
	return nil
}

func (s *store) listDrafts(ctx context.Context, userID string, jobID int64) ([]resumeDraft, error) {
	iter := s.userRef(userID).Collection("drafts").Where("jobId", "==", jobID).Documents(ctx)
	defer iter.Stop()
	drafts := make([]resumeDraft, 0)
	for {
		snapshot, err := iter.Next()
		if errors.Is(err, iterator.Done) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("list resume drafts: %w", err)
		}
		var value resumeDraft
		if err := snapshot.DataTo(&value); err != nil {
			return nil, fmt.Errorf("decode resume draft: %w", err)
		}
		drafts = append(drafts, value)
	}
	sort.Slice(drafts, func(i, j int) bool {
		return drafts[i].CreatedAt.After(drafts[j].CreatedAt)
	})
	return drafts, nil
}

func (s *store) createDraft(ctx context.Context, userID string, jobID int64, prompt, content string) (resumeDraft, error) {
	userRef := s.userRef(userID)
	now := time.Now().UTC()
	var value resumeDraft
	err := s.client.RunTransaction(ctx, func(ctx context.Context, tx *firestore.Transaction) error {
		userSnapshot, err := tx.Get(userRef)
		nextID := int64(1)
		if err != nil && status.Code(err) != codes.NotFound {
			return fmt.Errorf("read draft counter: %w", err)
		}
		if err == nil {
			if current, ok := userSnapshot.Data()["nextDraftID"].(int64); ok {
				nextID = current + 1
			} else if current, ok := userSnapshot.Data()["nextDraftID"].(float64); ok {
				nextID = int64(current) + 1
			}
		}
		value = resumeDraft{
			ID:        nextID,
			UserID:    userID,
			JobID:     jobID,
			Prompt:    prompt,
			Content:   content,
			CreatedAt: now,
			UpdatedAt: now,
		}
		if err := tx.Set(userRef, map[string]any{"nextDraftID": nextID}, firestore.MergeAll); err != nil {
			return fmt.Errorf("update draft counter: %w", err)
		}
		return tx.Set(s.draftRef(userID, nextID), value)
	})
	if err != nil {
		return resumeDraft{}, fmt.Errorf("create resume draft transaction: %w", err)
	}
	return value, nil
}

func (s *store) updateDraft(ctx context.Context, userID string, draftID int64, content string) (resumeDraft, error) {
	ref := s.draftRef(userID, draftID)
	snapshot, err := ref.Get(ctx)
	if status.Code(err) == codes.NotFound {
		return resumeDraft{}, errNotFound
	}
	if err != nil {
		return resumeDraft{}, fmt.Errorf("get resume draft: %w", err)
	}
	var value resumeDraft
	if err := snapshot.DataTo(&value); err != nil {
		return resumeDraft{}, fmt.Errorf("decode resume draft: %w", err)
	}
	value.Content = content
	value.UpdatedAt = time.Now().UTC()
	if _, err := ref.Set(ctx, value); err != nil {
		return resumeDraft{}, fmt.Errorf("update resume draft: %w", err)
	}
	return value, nil
}

func (s *store) getDraft(ctx context.Context, userID string, draftID int64) (resumeDraft, error) {
	snapshot, err := s.draftRef(userID, draftID).Get(ctx)
	if status.Code(err) == codes.NotFound {
		return resumeDraft{}, errNotFound
	}
	if err != nil {
		return resumeDraft{}, fmt.Errorf("get resume draft: %w", err)
	}
	var value resumeDraft
	if err := snapshot.DataTo(&value); err != nil {
		return resumeDraft{}, fmt.Errorf("decode resume draft: %w", err)
	}
	return value, nil
}
