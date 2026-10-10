package main

import (
	"fmt"
	"sonar.example/learning/library"
	"time"
)

var cache = map[string]library.Record{}
var repository library.Repository

// main contains repeated calls, branches, early returns, and a loop in a long entry.
func main() {
	now := time.Now()
	fmt.Println(now)
	if record, ok := cache["key"]; ok {
		fmt.Println(record)
		return
	}
	record, err := repository.Lookup("key")
	if err != nil {
		fmt.Println(err)
		return
	}
	for i := 0; i < 2; i++ {
		if i == 0 {
			record = library.Normalize(record)
		} else {
			record.Value += i
		}
	}
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	record = library.Normalize(record)
	cache["key"] = record
	fmt.Println(record)
}

// Recurse permits bounded navigation through a repeated function.
func Recurse(n int) int {
	if n <= 0 {
		return n
	}
	return Recurse(n - 1)
}

// Unsupported stops at a control region whose continuation is not analyzed.
func Unsupported(ch chan int) int {
	select {
	case value := <-ch:
		return value
	default:
		return 0
	}
}

// Mappings demonstrates shadowing, reassignment, discarded results, and alias boundaries.
func Mappings(value int) int {
	value, err := library.Pair(value)
	if err != nil {
		return value
	}
	{
		value := library.Sum(value, 2)
		fmt.Println(value)
	}
	value, _ = library.Pair(value)
	library.Pair(value)
	values := []int{value, 2}
	value = library.Sum(values...)
	ptr := &value
	*ptr = value + 1
	return value
}
