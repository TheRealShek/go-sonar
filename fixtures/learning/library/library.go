package library

// Record stores one value for the learning fixture.
type Record struct{ Value int }

// Repository declares a lookup contract whose dynamic implementation stays unresolved.
type Repository interface{ Lookup(string) (Record, error) }

// Normalize returns a transformed record.
func Normalize(record Record) Record { record.Value++; return record }

// Pair returns two positions for argument/result inspection.
func Pair(value int) (int, error) { return value, nil }

// Sum demonstrates ordinary variadic arguments and slice expansion.
func Sum(values ...int) int {
	total := 0
	for _, value := range values {
		total += value
	}
	return total
}
