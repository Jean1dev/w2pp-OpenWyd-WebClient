// WydDialect: translation between the Go tmserver wire dialect (7662 layouts,
// read and written by explicit little-endian offsets) and the in-memory
// structs of the OpenWyd runtime (Basedef.h).
//
// The runtime's scenes cast packets straight to their own structs. Those
// structs differ from what the server sends (18 vs 16 equipment slots, short
// vs int Level, extra fields, different tails), so every frame crosses this
// boundary before a consumer sees it and before CPSock obfuscates it. Frames
// whose layout has not been verified are dropped and counted, never passed
// through on the assumption that equal opcodes mean equal layouts.
#pragma once

enum WydDialectResult
{
	// Layout verified identical: use the original frame unchanged.
	WYD_DIALECT_PASS = 0,
	// Translated into the output buffer.
	WYD_DIALECT_TRANSLATED = 1,
	// Not delivered: unknown opcode, wrong size or a value the target cannot hold.
	WYD_DIALECT_DROP = 2,
};

constexpr int WYD_DIALECT_MAX_FRAME = 8192;

// Server -> client. wire is a decoded (plaintext) frame including its 12-byte
// header. On TRANSLATED, out holds a runtime struct of *outSize bytes.
int WydDialectInbound(const char* wire, int wireSize, char* out, int outCap, int* outSize);

// Client -> server. msg is a runtime struct as the scenes build it. On
// TRANSLATED, out holds the server-dialect frame of *outSize bytes.
int WydDialectOutbound(const char* msg, int msgSize, char* out, int outCap, int* outSize);

// Overwrites credential fields of an outbound runtime struct once it has been
// sent, so passwords do not linger in scene stack frames or buffers.
void WydDialectScrubOutbound(char* msg, int msgSize);

// True when the runtime struct carries a password or PIN (AccountLogin,
// DeleteCharacter, AccountSecure).
bool WydDialectIsCredential(const char* msg, int msgSize);

// AccountLogin.Version expected by the server (its -client-version). This is
// not the 7662 build number; 0 means "not configured" and blocks login.
void WydDialectSetClientVersion(int version);
int WydDialectClientVersion();

enum WydDialectStat
{
	WYD_STAT_IN_PASS = 0,
	WYD_STAT_IN_TRANSLATED,
	WYD_STAT_IN_DROP_UNKNOWN,
	WYD_STAT_IN_DROP_SIZE,
	WYD_STAT_IN_DROP_RANGE,
	WYD_STAT_OUT_PASS,
	WYD_STAT_OUT_TRANSLATED,
	WYD_STAT_OUT_DROP_UNKNOWN,
	WYD_STAT_OUT_DROP_SIZE,
	WYD_STAT_OUT_DROP_RANGE,
	WYD_STAT_OUT_DROP_NO_VERSION,
	// Fields narrowed with an explicit rule (value outside the runtime type):
	// set to zero and counted instead of silently truncated.
	WYD_STAT_FIELD_ZEROED,
	// Non-empty cargo slots 120..127: kept in memory, not shown by the 3x40 UI.
	WYD_STAT_CARGO_HIDDEN,
	// Non-zero bytes in wire regions whose meaning is not mapped.
	WYD_STAT_UNMAPPED_NONZERO,
	// MSG_Attack frames (0x367/0x39D/0x39E) translated in each direction:
	// evidence that combat reached the server and its result came back.
	WYD_STAT_IN_ATTACK,
	WYD_STAT_OUT_ATTACK,
	WYD_STAT_COUNT
};

unsigned int WydDialectStatValue(int stat);
void WydDialectResetStats();

// FNV-1a of inbound frame bytes [4, Size) in arrival order, and frame count.
unsigned int WydDialectInboundHash();
unsigned int WydDialectInboundFrames();

// Distinct opcodes dropped in each direction (for evidence, bounded).
constexpr int WYD_DIALECT_DROP_LOG = 64;
int WydDialectDroppedCount(int outbound);
unsigned int WydDialectDroppedOpcode(int outbound, int index);
unsigned int WydDialectDroppedTimes(int outbound, int index);
