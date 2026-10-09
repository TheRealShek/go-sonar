package sample

import "sonar.example/sample/store"

// Service retrieves and caches records.
type Service struct {
	Cache      map[string]store.Record
	Repository store.Repository
}

// Get first reads the cache and then delegates a cache miss.
func (s *Service) Get(key string) (store.Record, error) {
	if record, ok := s.Cache[key]; ok {
		return record, nil
	}
	record, err := s.Repository.Lookup(key)
	if err != nil {
		return store.Record{}, err
	}
	record = store.Normalize(record)
	s.Cache[key] = record

	return record, nil
}
