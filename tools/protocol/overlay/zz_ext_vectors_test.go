// This file is injected into tmserver/internal/protocol with `go test -overlay`
// by tools/protocol/run_go_vectors.py. It is not part of the server checkout:
// it exercises the server's real codec and framer against vectors produced by
// the independent reference in tools/protocol/cpsock_ref.py.
package protocol

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func extDir(t *testing.T) string {
	t.Helper()
	d := os.Getenv("W2PP_EXT_VECTORS")
	if d == "" {
		t.Skip("W2PP_EXT_VECTORS not set")
	}
	return d
}

func extHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatalf("bad hex: %v", err)
	}
	return b
}

type extTransport struct {
	IKeyWord uint8  `json:"iKeyWord"`
	PlainHex string `json:"plain_hex"`
	WireHex  string `json:"wire_hex"`
	Checksum uint8  `json:"checksum"`
}

// TestExtTransportVectors: Encode(plain) == wire and Decode(wire) == plain
// for every independently generated frame.
func TestExtTransportVectors(t *testing.T) {
	dir := filepath.Join(extDir(t), "transport")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	ran := 0
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		t.Run(e.Name(), func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
			if err != nil {
				t.Fatal(err)
			}
			var v extTransport
			if err := json.Unmarshal(raw, &v); err != nil {
				t.Fatal(err)
			}
			plain, wire := extHex(t, v.PlainHex), extHex(t, v.WireHex)
			h, err := DecodeHeader(plain)
			if err != nil {
				t.Fatal(err)
			}
			got, err := Encode(h, plain[HeaderSize:], v.IKeyWord)
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != string(wire) {
				t.Fatalf("encode mismatch at %d bytes", len(wire))
			}
			if got[3] != v.Checksum {
				t.Fatalf("checksum %d, want %d", got[3], v.Checksum)
			}
			gh, body, mismatch, err := Decode(wire)
			if err != nil || mismatch {
				t.Fatalf("decode err=%v mismatch=%v", err, mismatch)
			}
			if gh.Type != h.Type || gh.ID != h.ID || gh.ClientTick != h.ClientTick ||
				string(body) != string(plain[HeaderSize:]) {
				t.Fatal("decode does not restore header fields/body")
			}
		})
		ran++
	}
	if ran < 50 {
		t.Fatalf("only %d vectors found", ran)
	}
}

type extStream struct {
	Name        string   `json:"name"`
	Direction   string   `json:"direction"`
	StreamHex   string   `json:"stream_hex"`
	Chunks      []int    `json:"chunks"`
	FramesHex   []string `json:"expect_frames_hex"`
	ChecksumOK  []bool   `json:"expect_checksum_ok"`
	ExpectError string   `json:"expect_error"`
}

// chunkReader returns the stream in exactly the planned read sizes, like TCP
// segments that split or coalesce CPSock frames.
type chunkReader struct {
	data   []byte
	chunks []int
}

func (r *chunkReader) Read(p []byte) (int, error) {
	if len(r.chunks) == 0 {
		return 0, io.EOF
	}
	n := r.chunks[0]
	if n > len(p) {
		n = len(p)
		r.chunks[0] -= n
	} else {
		r.chunks = r.chunks[1:]
	}
	copy(p, r.data[:n])
	r.data = r.data[n:]
	return n, nil
}

// TestExtStreams: the server framer (client->server direction only) splits
// adversarial chunkings exactly and rejects invalid streams.
func TestExtStreams(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(extDir(t), "streams.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []extStream
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	ran := 0
	for _, c := range cases {
		if c.Direction != "c2s" {
			continue // the Go Framer only parses what the client sends
		}
		ran++
		t.Run(c.Name, func(t *testing.T) {
			f := NewFramer(&chunkReader{data: extHex(t, c.StreamHex), chunks: append([]int(nil), c.Chunks...)})
			var frames [][]byte
			var ferr error
			for {
				fr, err := f.ReadFrame()
				if err != nil {
					ferr = err
					break
				}
				frames = append(frames, fr)
			}
			switch c.ExpectError {
			case "":
				if !errors.Is(ferr, io.EOF) {
					t.Fatalf("stream ended with %v, want clean EOF", ferr)
				}
			case "bad_init":
				if !errors.Is(ferr, ErrBadInitCode) {
					t.Fatalf("got %v, want ErrBadInitCode", ferr)
				}
			case "bad_size":
				if !errors.Is(ferr, ErrBadSize) {
					t.Fatalf("got %v, want ErrBadSize", ferr)
				}
			case "unexpected_eof":
				if !errors.Is(ferr, io.ErrUnexpectedEOF) {
					t.Fatalf("got %v, want ErrUnexpectedEOF", ferr)
				}
			default:
				t.Fatalf("unknown expectation %q", c.ExpectError)
			}
			if len(frames) != len(c.FramesHex) {
				t.Fatalf("got %d frames, want %d", len(frames), len(c.FramesHex))
			}
			for i, want := range c.FramesHex {
				if hex.EncodeToString(frames[i]) != want {
					t.Fatalf("frame %d differs", i)
				}
				_, _, mismatch, err := Decode(frames[i])
				if err != nil {
					t.Fatal(err)
				}
				if mismatch == c.ChecksumOK[i] {
					t.Fatalf("frame %d checksum mismatch=%v, want ok=%v", i, mismatch, c.ChecksumOK[i])
				}
			}
		})
	}
	if ran == 0 {
		t.Fatal("no c2s streams")
	}
}
