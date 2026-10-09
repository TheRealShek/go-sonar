package store

import "errors"

// Record carries the persistent value.
type Record struct {
	Key   string
	Value string
}

// Repository is the lookup contract.
type Repository interface{ Lookup(string) (Record, error) }

// Memory is a small repository implementation.
type Memory struct{ Records map[string]Record }

// Lookup returns a record or a missing-key error.
func (m *Memory) Lookup(key string) (Record, error) {
	if record, ok := m.Records[key]; ok {
		return record, nil
	}
	return Record{}, errors.New("missing key")
}

// Normalize applies a deterministic value transformation.
func Normalize(record Record) Record { record.Value = "value:" + record.Value; return record }
