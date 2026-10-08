// See WydDialect.h. Wire offsets below are absolute frame offsets (header
// included) of the Go tmserver codecs at the pinned revision:
//   tmserver/internal/protocol/{selchar,mob,createmob,messages,score,affect,shop,autotrade}.go
// and docs/compatibility.md. Runtime-side values are written by field, so the
// runtime's own ABI decides its layout; static_asserts pin the layouts that
// pass-through frames rely on.
#if !defined(WYD_DIALECT_STANDALONE)
#include "pch.h"
#endif
#include "WydDialect.h"
#include "Basedef.h"

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>

namespace
{
// ---- runtime layout contract (measured by tools/probe_upstream_layouts.py) ----
static_assert(sizeof(MSG_STANDARD) == 12, "header");
static_assert(sizeof(MSG_REQParty) == 44 && offsetof(MSG_REQParty, TargetID) == 40, "REQParty");
static_assert(sizeof(MSG_AddParty) == 40 && sizeof(PARTY) == 26, "AddParty");
static_assert(sizeof(MSG_CNFParty2) == 32 && offsetof(MSG_CNFParty2, LeaderName) == 14, "AcceptParty");
static_assert(sizeof(MSG_Trade) == 156 && offsetof(MSG_Trade, CarryPos) == 132 && offsetof(MSG_Trade, TradeMoney) == 148 &&
	offsetof(MSG_Trade, MyCheck) == 152 && offsetof(MSG_Trade, OpponentID) == 154, "Trade");
static_assert(sizeof(STRUCT_ITEM) == 8, "STRUCT_ITEM");
static_assert(sizeof(STRUCT_SCORE) == 48, "STRUCT_SCORE");
static_assert(MAX_CARGO >= 128, "cargo must hold the server's 128 slots (patch 0003)");
// Pass-through frames: byte layout must equal the server's.
static_assert(sizeof(MSG_Action) == 52 && offsetof(MSG_Action, PosX) == 12 &&
	offsetof(MSG_Action, Effect) == 16 && offsetof(MSG_Action, Speed) == 20 &&
	offsetof(MSG_Action, Route) == 24 && offsetof(MSG_Action, TargetX) == 48, "MSG_Action");
static_assert(sizeof(MSG_MessagePanel) == 140 && offsetof(MSG_MessagePanel, String) == 12, "MessagePanel");
static_assert(sizeof(MSG_RemoveMob) == 16 && offsetof(MSG_RemoveMob, RemoveType) == 12, "RemoveMob");
static_assert(sizeof(MSG_STANDARDPARM) == 16 && offsetof(MSG_STANDARDPARM, Parm) == 12, "StandardParm");
static_assert(sizeof(MSG_NewCharacter) == 36 && offsetof(MSG_NewCharacter, Slot) == 12 &&
	offsetof(MSG_NewCharacter, MobName) == 16 && offsetof(MSG_NewCharacter, Class) == 32, "NewCharacter");
// Translated frames: sizes the scenes expect.
static_assert(sizeof(MSG_AccountLogin) == 116, "AccountLogin");
static_assert(sizeof(MSG_CharacterLogin) == 36, "CharacterLogin");
static_assert(sizeof(MSG_DeleteCharacter) == 48 && offsetof(MSG_DeleteCharacter, Password) == 32, "DeleteCharacter");
static_assert(sizeof(MSG_CHARPASSWORD) == 32 && offsetof(MSG_CHARPASSWORD, ItemPassWord) == 12 &&
	offsetof(MSG_CHARPASSWORD, State) == 28, "AccountSecure");
static_assert(sizeof(STRUCT_SELCHAR) == 904, "STRUCT_SELCHAR");
static_assert(sizeof(STRUCT_MOB) == 1040, "STRUCT_MOB");
static_assert(sizeof(MSG_CreateMob) == 236, "MSG_CreateMob");
static_assert(sizeof(MSG_CreateMobTrade) == 260, "MSG_CreateMobTrade");
static_assert(sizeof(MSG_UpdateScore) == 152 && offsetof(MSG_UpdateScore, Critical) == 60 &&
	offsetof(MSG_UpdateScore, Affect) == 62 && offsetof(MSG_UpdateScore, Guild) == 126 &&
	offsetof(MSG_UpdateScore, Resist) == 130 && offsetof(MSG_UpdateScore, ReqHp) == 136 &&
	offsetof(MSG_UpdateScore, Magic) == 144 && offsetof(MSG_UpdateScore, LearnedSkill) == 148, "UpdateScore");
static_assert(sizeof(STRUCT_AFFECT) == 8 && sizeof(MSG_UpdateAffect) == 268, "UpdateAffect");
static_assert(sizeof(MSG_UpdateEquip) == 68, "UpdateEquip");
static_assert(sizeof(MSG_SetHpDam) == 20 && offsetof(MSG_SetHpDam, Dam) == 16, "SetHpDam");
// Pass-through in-world frames: byte layout equals the server's.
static_assert(sizeof(MSG_SetHpMp) == 28 && offsetof(MSG_SetHpMp, Hp) == 12 &&
	offsetof(MSG_SetHpMp, ReqMp) == 24, "SetHpMp");
static_assert(sizeof(MSG_SendItem) == 24 && offsetof(MSG_SendItem, DestPos) == 14 &&
	offsetof(MSG_SendItem, Item) == 16, "SendItem");
// UpdateEtc: server Hold@12 lands on FakeExp, Learn(i64)@24 on LearnedSkill[2],
// server Magic(u16)@38 on the runtime's padding before Coin.
static_assert(sizeof(MSG_UpdateEtc) == 48 && offsetof(MSG_UpdateEtc, Exp) == 16 &&
	offsetof(MSG_UpdateEtc, LearnedSkill) == 24 && offsetof(MSG_UpdateEtc, ScoreBonus) == 32 &&
	offsetof(MSG_UpdateEtc, SkillBonus) == 36 && offsetof(MSG_UpdateEtc, Coin) == 40, "UpdateEtc");
// Attack: the three runtime structs share one prefix and differ in Dam[] length.
static_assert(sizeof(STRUCT_DAM) == 8 && offsetof(STRUCT_DAM, Damage) == 4, "STRUCT_DAM");
static_assert(sizeof(MSG_Attack) == 168 && sizeof(MSG_AttackOne) == 72 && sizeof(MSG_AttackTwo) == 80, "Attack sizes");
static_assert(offsetof(MSG_Attack, FakeExp) == 12 && offsetof(MSG_Attack, ReqMp) == 16 &&
	offsetof(MSG_Attack, CurrentExp) == 24 && offsetof(MSG_Attack, Rsv) == 32 &&
	offsetof(MSG_Attack, PosX) == 34 && offsetof(MSG_Attack, TargetY) == 40 &&
	offsetof(MSG_Attack, AttackerID) == 42 && offsetof(MSG_Attack, Progress) == 44 &&
	offsetof(MSG_Attack, Motion) == 46 && offsetof(MSG_Attack, FlagLocal) == 47 &&
	offsetof(MSG_Attack, DoubleCritical) == 48 && offsetof(MSG_Attack, SkillParm) == 49 &&
	offsetof(MSG_Attack, CurrentMp) == 52 && offsetof(MSG_Attack, SkillIndex) == 56 &&
	offsetof(MSG_Attack, Dam) == 60, "MSG_Attack");
static_assert(offsetof(MSG_AttackOne, Dam) == 60 && offsetof(MSG_AttackTwo, Dam) == 60 &&
	offsetof(MSG_AttackOne, SkillIndex) == 56 && offsetof(MSG_AttackTwo, SkillIndex) == 56, "Attack prefix");
// NPC shop / skill learning: identical to protocol/shop.go EncodeShopListBody
// (ShopType@12, List[27]@16 of 8-byte items, Tax@232), reqShopList (u16
// target @12) and MsgApplyBonusBody (BonusType@12, Detail@14, TargetID@16).
static_assert(sizeof(STRUCT_ITEM) == 8 && sizeof(MSG_ShopList) == 236 && offsetof(MSG_ShopList, ShopType) == 12 &&
	offsetof(MSG_ShopList, List) == 16 && offsetof(MSG_ShopList, Tax) == 232, "MSG_ShopList");
// Motion (level-up/emote animation, mobkilled.go): server Motion u16@12, Parm
// u16@14, NotUsed int32@16 always zero -> runtime Direction float@16 = 0.0f.
static_assert(sizeof(MSG_Motion) == 20 && offsetof(MSG_Motion, Motion) == 12 && offsetof(MSG_Motion, Parm) == 14 &&
	offsetof(MSG_Motion, Direction) == 16, "MSG_Motion");
static_assert(offsetof(MSG_REQShopList, TargetID) == 12 && sizeof(MSG_REQShopList) == 16, "MSG_REQShopList");
// Items (ADR 007). SwapItem (0x376, handler/item.go tradingItem): four u8 at
// @12..15 on both sides; the server names them Dest/Src and the runtime
// Sour/Dest, but the server swap is symmetric and echoes the payload as
// received, so bytes map by position. Runtime TargetID u16@16 + padding ->
// server WarpID i32@16. UseItem: runtime 36 (padding @34), server 34.
static_assert(sizeof(MSG_SwapItem) == 20 && offsetof(MSG_SwapItem, SourType) == 12 &&
	offsetof(MSG_SwapItem, SourPos) == 13 && offsetof(MSG_SwapItem, DestType) == 14 &&
	offsetof(MSG_SwapItem, DestPos) == 15 && offsetof(MSG_SwapItem, TargetID) == 16, "MSG_SwapItem");
static_assert(sizeof(MSG_UseItem) == 36 && offsetof(MSG_UseItem, SourType) == 12 &&
	offsetof(MSG_UseItem, DestPos) == 24 && offsetof(MSG_UseItem, GridX) == 28 &&
	offsetof(MSG_UseItem, GridY) == 30 && offsetof(MSG_UseItem, ItemID) == 32, "MSG_UseItem");
// DeleteItem (0x2E4, handler/item.go deleteItem): runtime MSG_STANDARDPARM2
// {Parm1 = carry slot, Parm2 = sIndex}, server {Slot i32, SIndex i32}; same bytes.
static_assert(sizeof(MSG_STANDARDPARM2) == 20 && offsetof(MSG_STANDARDPARM2, Parm1) == 12 &&
	offsetof(MSG_STANDARDPARM2, Parm2) == 16, "MSG_STANDARDPARM2");
// UpdateCarry (0x185, protocol/carry.go): Carry[64]@12 + Coin@524, identical.
static_assert(sizeof(MSG_Carry) == 528 && offsetof(MSG_Carry, Carry) == 12 &&
	offsetof(MSG_Carry, Coin) == 524, "MSG_Carry");
// Shop, cargo gold and chat (ADR 008). MSG_Buy: TargetID@12, TargetCarryPos@14,
// MyCarryPos@16, padding @18, Coin@20 (handler/shop.go buy reads @12/14/16 and
// writes the new gold at @20 of its echo). MSG_Sell (20) and
// MSG_MessageWhisper (160) end in 2 bytes of alignment padding that the
// server's 18/158-byte contract does not have; the padding is never sent.
// Chat and whisper are forwarded unchanged by the server (handler/chat.go;
// protocol MsgWhisperBody: MobName[16] + trailing string).
static_assert(sizeof(MSG_Buy) == 24 && offsetof(MSG_Buy, TargetID) == 12 &&
	offsetof(MSG_Buy, TargetCarryPos) == 14 && offsetof(MSG_Buy, MyCarryPos) == 16 &&
	offsetof(MSG_Buy, Coin) == 20, "MSG_Buy");
static_assert(sizeof(MSG_Sell) == 20 && offsetof(MSG_Sell, TargetID) == 12 && offsetof(MSG_Sell, MyType) == 14 &&
	offsetof(MSG_Sell, MyPos) == 16, "MSG_Sell");
static_assert(sizeof(MSG_MessageChat) == 140 && offsetof(MSG_MessageChat, String) == 12, "MSG_MessageChat");
static_assert(sizeof(MSG_MessageWhisper) == 160 && offsetof(MSG_MessageWhisper, MobName) == 12 &&
	offsetof(MSG_MessageWhisper, String) == 28 && offsetof(MSG_MessageWhisper, Color) == 156, "MSG_MessageWhisper");
static_assert(offsetof(MSG_ApplyBonus, BonusType) == 12 && offsetof(MSG_ApplyBonus, Detail) == 14 &&
	offsetof(MSG_ApplyBonus, TargetID) == 16 && sizeof(MSG_ApplyBonus) == 20, "MSG_ApplyBonus");

// ---- server wire contract ----
constexpr int kHeader = 12;
constexpr int kItem = 8;
constexpr int kScore = 48;
constexpr int kEquipWire = 16;
constexpr int kCargoWire = 128;
constexpr int kCargoVisible = 120; // 3 pages x 40 cells in TMFieldScene

constexpr int kCNFAccountLogin = 2008;
constexpr int kCNFSelChar = 856; // CNFNewCharacter / CNFDeleteCharacter
constexpr int kCNFCharacterLogin = 1832;
constexpr int kCreateMob = 232;
constexpr int kCreateMobTrade = 252;
constexpr int kUpdateScore = 152;
constexpr int kSendAffect = 268;
constexpr int kUpdateEquip = 60;
constexpr int kSetHpDam = 20;
constexpr int kSwapItem = 20;
constexpr int kDeleteItem = 20;
constexpr int kUseItemWire = 34;
constexpr int kUpdateCarry = 528;
constexpr int kUpdateCargoCoin = 57; // protocol/cargo.go: coin @12 (UNVERIFIED offset)
constexpr int kBuy = 24;
constexpr int kSell = 18;
constexpr int kWhisperFixed = 28; // header + MobName[16]; the text is the remainder
constexpr int kWhisper = 158;     // MobName + String[128] + Color, no tail padding
// Slots the runtime grids can hold (TMFieldScene OnPacketSwapItem indexes
// m_pGridInvList[pos/15] over 4 pages and the 16 server equip slots).
constexpr int kEquipSlots = 16;
constexpr int kCarryVisible = 60;
// Attack: fixed part up to Dam[] @60, then N x {TargetID i32, Damage i32}.
constexpr int kAttackFixed = 60;
constexpr int kAttackDam = 8;
constexpr int kMaxTarget = 13;

constexpr int kAccountLoginWire = 116;
constexpr int kCharacterLoginWire = 20;
constexpr int kDeleteCharacterWire = 44;
constexpr int kAccountSecureWire = 32;
constexpr int kPinDigits = 6; // server NumericToken[6]; the keypad stops at 6

enum : unsigned short
{
	OpMessagePanel = 0x101,
	OpMessageBoxOk = 0x102,
	OpCNFAccountLogin = 0x10A,
	OpCNFNewCharacter = 0x110,
	OpCNFDeleteCharacter = 0x112,
	OpCNFCharacterLogin = 0x114,
	OpCNFCharacterLogout = 0x116,
	OpCharacterLoginFail = 0x119,
	OpNewCharacterFail = 0x11A,
	OpDeleteCharacterFail = 0x11B,
	OpAlreadyPlaying = 0x11C,
	OpAlreadyPlaying2 = 0x11D,
	OpRemoveMob = 0x165,
	OpPKInfo = 0x166,
	OpSetHpMp = 0x181,
	OpSendItem = 0x182,
	OpSetHpDam = 0x18A,
	OpUpdateWeather = 0x18B,
	OpUpdateScore = 0x336,
	OpUpdateEtc = 0x337,
	OpCreateMobTrade = 0x363,
	OpUpdateEquip = 0x36B,
	OpSendAffect = 0x3B9,
	OpAccountLogin = 0x20D,
	OpNewCharacter = 0x20F,
	OpDeleteCharacter = 0x211,
	OpCharacterLogin = 0x213,
	OpCharacterLogout = 0x215,
	OpReqTeleport = 0x290,
	OpChangeCity = 0x291,
	OpCreateMob = 0x364,
	OpActionStop = 0x366,
	OpAttack = 0x367,
	OpAttackOne = 0x39D,
	OpAttackTwo = 0x39E,
	OpRestart = 0x289,
	OpReqMobByID = 0x369,
	OpDelayStart = 0x3AE,
	OpSetShortSkill = 0x378,
	OpShopList = 0x17C,
	OpREQShopList = 0x27B,
	OpApplyBonus = 0x277,
	OpMotion = 0x36A,
	OpUseItem = 0x373,
	OpSwapItem = 0x376,
	OpDeleteItem = 0x2E4,
	OpUpdateCarry = 0x185,
	OpAction2 = 0x368,
	OpAction = 0x36C,
	OpPing = 0x3A0,
	OpMessageChat = 0x333,
	OpMessageWhisper = 0x334,
	OpUpdateCargoCoin = 0x339,
	OpBuy = 0x379,
	OpSell = 0x37A,
	OpWithdraw = 0x387,
	OpDeposit = 0x388,
	OpAccountSecure = 0xFDE,
	OpAccountSecureFail = 0xFDF,
	OpReqParty = 0x37F,
	OpAcceptParty = 0x3AB,
	OpAddParty = 0x37D,
	OpRemoveParty = 0x37E,
	OpTrade = 0x383,
	OpQuitTrade = 0x384,
	OpCNFCheck = 0x386,
};

int g_clientVersion = 0;
unsigned int g_stats[WYD_STAT_COUNT];
// FNV-1a over every inbound frame's bytes [4, Size): lets a test prove which
// frames the runtime framed, in order, without exposing payload.
std::uint32_t g_inHash = 2166136261u;
unsigned int g_inFrames = 0;

struct DropLog
{
	int count;
	unsigned int opcode[WYD_DIALECT_DROP_LOG];
	unsigned int times[WYD_DIALECT_DROP_LOG];
};
DropLog g_drops[2];

void Count(int stat, unsigned int n = 1) { g_stats[stat] += n; }

void LogDrop(int outbound, unsigned int opcode)
{
	DropLog& d = g_drops[outbound ? 1 : 0];
	for (int i = 0; i < d.count; ++i)
	{
		if (d.opcode[i] == opcode)
		{
			++d.times[i];
			return;
		}
	}
	if (d.count < WYD_DIALECT_DROP_LOG)
	{
		d.opcode[d.count] = opcode;
		d.times[d.count] = 1;
		++d.count;
	}
}

// Little-endian reads from the wire, independent of host struct layout.
std::uint8_t U8(const char* p, int off) { return static_cast<std::uint8_t>(p[off]); }
std::uint16_t U16(const char* p, int off) { return static_cast<std::uint16_t>(U8(p, off) | (U8(p, off + 1) << 8)); }
std::uint32_t U32(const char* p, int off) { return U16(p, off) | (static_cast<std::uint32_t>(U16(p, off + 2)) << 16); }
std::uint64_t U64(const char* p, int off) { return U32(p, off) | (static_cast<std::uint64_t>(U32(p, off + 4)) << 32); }
std::int16_t I16(const char* p, int off) { return static_cast<std::int16_t>(U16(p, off)); }
std::int32_t I32(const char* p, int off) { return static_cast<std::int32_t>(U32(p, off)); }

void Put16(char* p, int off, std::uint16_t v)
{
	p[off] = static_cast<char>(v & 0xFF);
	p[off + 1] = static_cast<char>(v >> 8);
}
void Put32(char* p, int off, std::uint32_t v)
{
	Put16(p, off, static_cast<std::uint16_t>(v));
	Put16(p, off + 2, static_cast<std::uint16_t>(v >> 16));
}

void CountNonZero(const char* p, int from, int to)
{
	for (int i = from; i < to; ++i)
	{
		if (p[i])
		{
			Count(WYD_STAT_UNMAPPED_NONZERO);
			return;
		}
	}
}

// Narrowing with an explicit rule: out-of-range values become 0 and are counted.
char NarrowChar(std::int64_t v)
{
	if (v < -128 || v > 127)
	{
		Count(WYD_STAT_FIELD_ZEROED);
		return 0;
	}
	return static_cast<char>(v);
}

short NarrowShort(std::int64_t v)
{
	if (v < -32768 || v > 32767)
	{
		Count(WYD_STAT_FIELD_ZEROED);
		return 0;
	}
	return static_cast<short>(v);
}

unsigned short NarrowUShort(std::int64_t v)
{
	if (v < 0 || v > 65535)
	{
		Count(WYD_STAT_FIELD_ZEROED);
		return 0;
	}
	return static_cast<unsigned short>(v);
}

void ReadItem(const char* w, int off, STRUCT_ITEM& it)
{
	it.sIndex = I16(w, off);
	for (int k = 0; k < 3; ++k)
	{
		it.stEffect[k].cEffect = U8(w, off + 2 + k * 2);
		it.stEffect[k].cValue = U8(w, off + 3 + k * 2);
	}
}

// Level is int32 on the wire and short in the runtime: refuse, never truncate.
bool ReadScore(const char* w, int off, STRUCT_SCORE& s)
{
	std::int32_t level = I32(w, off + 0);
	if (level < -32768 || level > 32767)
		return false;
	std::memset(&s, 0, sizeof(s));
	s.Level = static_cast<short>(level);
	s.Ac = I32(w, off + 4);
	s.Damage = I32(w, off + 8);
	s.Reserved = static_cast<char>(U8(w, off + 12)); // server: Merchant
	s.AttackRun = static_cast<char>(U8(w, off + 13));
	// off+14 Direction has no runtime field (padding in STRUCT_SCORE).
	s.MaxHp = I32(w, off + 16);
	s.MaxMp = I32(w, off + 20);
	s.Hp = I32(w, off + 24);
	s.Mp = I32(w, off + 28);
	s.Str = I16(w, off + 32);
	s.Int = I16(w, off + 34);
	s.Dex = I16(w, off + 36);
	s.Con = I16(w, off + 38);
	for (int i = 0; i < 4; ++i)
		s.Special[i] = U16(w, off + 40 + i * 2);
	return true;
}

// STRUCT_SELCHAR: 840 bytes on the wire, 904 in the runtime (Equip[4][18]).
bool ReadSelChar(const char* w, int off, STRUCT_SELCHAR& sc)
{
	std::memset(&sc, 0, sizeof(sc));
	for (int s = 0; s < 4; ++s)
	{
		sc.HomeTownX[s] = U16(w, off + 0 + s * 2);
		sc.HomeTownY[s] = U16(w, off + 8 + s * 2);
		std::memcpy(sc.MobName[s], w + off + 16 + s * 16, 16);
		if (!ReadScore(w, off + 80 + s * kScore, sc.Score[s]))
			return false;
		for (int i = 0; i < kEquipWire; ++i)
			ReadItem(w, off + 272 + s * kEquipWire * kItem + i * kItem, sc.Equip[s][i]);
		// Equip[s][16..17] do not exist in this dialect: left empty.
		sc.Guild[s] = U16(w, off + 784 + s * 2);
		sc.Coin[s] = I32(w, off + 792 + s * 4);
		sc.Exp[s] = static_cast<long long>(U64(w, off + 808 + s * 8));
	}
	return true;
}

// STRUCT_MOB: 816 bytes on the wire, 1040 in the runtime.
bool ReadMob(const char* w, int off, STRUCT_MOB& m)
{
	std::memset(&m, 0, sizeof(m));
	std::memcpy(m.MobName, w + off, 16);
	m.Clan = static_cast<char>(U8(w, off + 16));
	m.Merchant = static_cast<char>(U8(w, off + 17));
	m.Guild = U16(w, off + 18);
	m.Class = static_cast<char>(U8(w, off + 20));
	// Rsv/Quest (@22..27) are template padding on the server side, and the raw
	// login encoder overwrites @24 with gold; the runtime reads neither for the
	// own character, so both stay zero.
	m.Coin = I32(w, off + 28);
	m.Exp = static_cast<long long>(U64(w, off + 32));
	m.HomeTownX = U16(w, off + 40);
	m.HomeTownY = U16(w, off + 42);
	if (!ReadScore(w, off + 44, m.BaseScore) || !ReadScore(w, off + 92, m.CurrentScore))
		return false;
	for (int i = 0; i < kEquipWire; ++i)
		ReadItem(w, off + 140 + i * kItem, m.Equip[i]);
	for (int i = 0; i < 64; ++i)
		ReadItem(w, off + 268 + i * kItem, m.Carry[i]);
	m.LearnedSkill[0] = U32(w, off + 780);
	// The server's Magic (@784, u32) is not a second learned-skill mask; the
	// runtime keeps a one-byte Magic. LearnedSkill[1] has no server source.
	m.Magic = NarrowChar(U32(w, off + 784));
	m.ScoreBonus = I16(w, off + 788);
	m.SpecialBonus = I16(w, off + 790);
	m.SkillBonus = I16(w, off + 792);
	m.Critical = static_cast<char>(U8(w, off + 794));
	m.SaveMana = static_cast<char>(U8(w, off + 795));
	std::memcpy(m.ShortSkill, w + off + 796, 4);
	m.GuildLevel = static_cast<char>(U8(w, off + 800));
	m.RegenHP = NarrowChar(U16(w, off + 802));
	m.RegenMP = NarrowChar(U16(w, off + 804));
	std::memcpy(m.Resist, w + off + 806, 4);
	return true;
}

int Fail(int stat, int outbound, unsigned int opcode)
{
	Count(stat);
	LogDrop(outbound, opcode);
	return WYD_DIALECT_DROP;
}

template <typename T>
T* Begin(const char* wire, char* out, int outCap, int* outSize)
{
	if (outCap < static_cast<int>(sizeof(T)))
		return nullptr;
	std::memset(out, 0, sizeof(T));
	std::memcpy(out, wire, kHeader); // Type, ID and server tick are kept
	auto* msg = reinterpret_cast<T*>(out);
	msg->Header.Size = static_cast<unsigned short>(sizeof(T));
	*outSize = static_cast<int>(sizeof(T));
	return msg;
}

int InCNFAccountLogin(const char* w, char* out, int outCap, int* outSize)
{
	auto* m = Begin<MSG_CNFAccountLogin>(w, out, outCap, outSize);
	if (!m)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, OpCNFAccountLogin);
	// SecretCode seeds the runtime's keyword queues; this server sends none
	// (@12..27 zero, @28 = "don't recreate starter potions" marker).
	if (!ReadSelChar(w, 32, m->SelChar))
		return Fail(WYD_STAT_IN_DROP_RANGE, 0, OpCNFAccountLogin);
	for (int i = 0; i < kCargoWire; ++i)
	{
		ReadItem(w, 872 + i * kItem, m->Cargo[i]);
		if (i >= kCargoVisible && m->Cargo[i].sIndex)
			Count(WYD_STAT_CARGO_HIDDEN);
	}
	m->Coin = I32(w, 1896);
	std::memcpy(m->AccountName, w + 1900, 16);
	CountNonZero(w, 1916, kCNFAccountLogin);
	return WYD_DIALECT_TRANSLATED;
}

int InCNFSelChar(const char* w, char* out, int outCap, int* outSize, unsigned short op)
{
	// CNFNewCharacter and CNFDeleteCharacter share the same layout.
	static_assert(sizeof(MSG_CNFNewCharacter) == sizeof(MSG_CNFDeleteCharacter), "selchar replies");
	auto* m = Begin<MSG_CNFNewCharacter>(w, out, outCap, outSize);
	if (!m)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	if (!ReadSelChar(w, 16, m->SelChar))
		return Fail(WYD_STAT_IN_DROP_RANGE, 0, op);
	return WYD_DIALECT_TRANSLATED;
}

int InCNFCharacterLogin(const char* w, char* out, int outCap, int* outSize)
{
	auto* m = Begin<MSG_CNFCharacterLogin>(w, out, outCap, outSize);
	if (!m)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, OpCNFCharacterLogin);
	m->PosX = I16(w, 12);
	m->PosY = I16(w, 14);
	if (!ReadMob(w, 16, m->MOB))
		return Fail(WYD_STAT_IN_DROP_RANGE, 0, OpCNFCharacterLogin);
	m->Slot = U16(w, 16 + 1024);
	m->ClientID = U16(w, 16 + 1026);
	m->Weather = U16(w, 16 + 1028);
	std::memcpy(m->ShortSkill, w + 16 + 1030, 16);
	// Ext1/Ext2 have no server source; left zero (Ext1.Data[0] is "fake exp").
	CountNonZero(w, 16 + 1046, kCNFCharacterLogin);
	return WYD_DIALECT_TRANSLATED;
}

// MSG_CreateMob and MSG_CreateMobTrade share their first 202 wire bytes and the
// runtime fields up to Nick; only the runtime offsets differ (18 equip slots).
template <typename T>
bool ReadCreateMob(const char* w, T* m)
{
	m->PosX = I16(w, 12);
	m->PosY = I16(w, 14);
	m->MobID = U16(w, 16);
	std::memcpy(m->MobName, w + 18, 16);
	for (int i = 0; i < kEquipWire; ++i)
		m->Equip[i] = U16(w, 34 + i * 2);
	for (int i = 0; i < 32; ++i)
		m->Affect[i] = U16(w, 66 + i * 2);
	m->Guild = U16(w, 130);
	m->GuildLevel = static_cast<char>(U8(w, 132)); // server: GuildMemberType
	if (!ReadScore(w, 136, m->Score))
		return false;
	m->CreateType = U16(w, 184);
	std::memcpy(m->Equip2, w + 186, kEquipWire); // AnctCode[16]
	return true;
}

int InCreateMob(const char* w, char* out, int outCap, int* outSize)
{
	auto* m = Begin<MSG_CreateMob>(w, out, outCap, outSize);
	if (!m)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, OpCreateMob);
	if (!ReadCreateMob(w, m))
		return Fail(WYD_STAT_IN_DROP_RANGE, 0, OpCreateMob);
	CountNonZero(w, 202, kCreateMob);
	return WYD_DIALECT_TRANSLATED;
}

// Shop-owner stall pose: CreateMob + Tab[26]@202 + Desc[24]@228.
int InCreateMobTrade(const char* w, char* out, int outCap, int* outSize)
{
	auto* m = Begin<MSG_CreateMobTrade>(w, out, outCap, outSize);
	if (!m)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, OpCreateMobTrade);
	if (!ReadCreateMob(w, m))
		return Fail(WYD_STAT_IN_DROP_RANGE, 0, OpCreateMobTrade);
	std::memcpy(m->Nick, w + 202, 26); // server Tab -> runtime Nick: hypothesis
	std::memcpy(m->Desc, w + 228, 24);
	return WYD_DIALECT_TRANSLATED;
}

// Same size, different tail: server CurrHp@136, CurrMp@140, Magic i32@144 and
// the legacy 0xCC quirk @148..151. The runtime reads ReqHp/ReqMp@136/140, Magic
// u16@144, Rsv@146 and a LearnedSkill byte @148 with no server source (zero).
int InUpdateScore(const char* w, char* out, int outCap, int* outSize)
{
	auto* m = Begin<MSG_UpdateScore>(w, out, outCap, outSize);
	if (!m)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, OpUpdateScore);
	if (!ReadScore(w, 12, m->Score))
		return Fail(WYD_STAT_IN_DROP_RANGE, 0, OpUpdateScore);
	m->Critical = static_cast<char>(U8(w, 60));
	m->SaveMana = static_cast<char>(U8(w, 61));
	for (int i = 0; i < 32; ++i)
		m->Affect[i] = U16(w, 62 + i * 2);
	m->Guild = U16(w, 126);
	m->GuildLevel = U16(w, 128);
	std::memcpy(m->Resist, w + 130, 4);
	CountNonZero(w, 134, 136);
	m->ReqHp = I32(w, 136);
	m->ReqMp = I32(w, 140);
	m->Magic = NarrowUShort(I32(w, 144));
	return WYD_DIALECT_TRANSLATED;
}

// STRUCT_AFFECT: server {Type u8, Value u8, Level u16, Time u32}; runtime
// {Type char, Level char, Value short, Time int}.
int InSendAffect(const char* w, char* out, int outCap, int* outSize)
{
	auto* m = Begin<MSG_UpdateAffect>(w, out, outCap, outSize);
	if (!m)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, OpSendAffect);
	for (int i = 0; i < 32; ++i)
	{
		const int o = 12 + i * 8;
		m->Affect[i].Type = static_cast<char>(U8(w, o));
		m->Affect[i].Value = static_cast<short>(U8(w, o + 1));
		m->Affect[i].Level = NarrowChar(U16(w, o + 2));
		m->Affect[i].Time = I32(w, o + 4);
	}
	return WYD_DIALECT_TRANSLATED;
}

// Equip[16] + AnctCode[16] on the wire; the runtime has 18 of each.
int InUpdateEquip(const char* w, char* out, int outCap, int* outSize)
{
	auto* m = Begin<MSG_UpdateEquip>(w, out, outCap, outSize);
	if (!m)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, OpUpdateEquip);
	for (int i = 0; i < kEquipWire; ++i)
		m->sEquip[i] = U16(w, 12 + i * 2);
	std::memcpy(m->Equip2, w + 44, kEquipWire);
	return WYD_DIALECT_TRANSLATED;
}

// Dam is int32 on the wire, short in the runtime.
int InSetHpDam(const char* w, char* out, int outCap, int* outSize)
{
	auto* m = Begin<MSG_SetHpDam>(w, out, outCap, outSize);
	if (!m)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, OpSetHpDam);
	m->Hp = I32(w, 12);
	m->Dam = NarrowShort(I32(w, 16));
	return WYD_DIALECT_TRANSLATED;
}

int AttackCapacity(unsigned short op)
{
	return op == OpAttackOne ? 1 : op == OpAttackTwo ? 2 : kMaxTarget;
}

// Server MSG_Attack (protocol/messages.go MsgAttackBody, handler/combat.go):
// 60 + 8N bytes, N = 1..13. It echoes the attacker's own frame after
// overwriting HP/Exp/MP/ReqMp and Dam[].Damage, so Rsv, FlagLocal and
// SkillParm are the runtime's bytes coming back. Divergences from Basedef.h:
//   @16 server CurrentHp (attacker)  -> runtime ReqMp; no runtime field, not copied
//   @58 server ReqMp i16             -> runtime padding; widened into ReqMp@16
//   Dam[].TargetID i32               -> u16 + padding
// The runtime subtracts ReqMp from its own MP when a player hits it
// (TMFieldScene::OnPacketAttack), so passing @16 through would drain MP by
// the attacker's HP.
struct CombatRing
{
	int values[64][37]{};
	unsigned int total = 0;
};
CombatRing g_combat[2];
bool g_combatEnabled = false;

void RecordCombat(int outbound, const char* w, int n)
{
	if (!g_combatEnabled) return;
	auto& ring = g_combat[outbound];
	int* v = ring.values[ring.total % 64];
	std::memset(v, 0, sizeof(ring.values[0]));
	v[0] = static_cast<int>(++ring.total);
	v[1] = U16(w, 42); v[2] = I16(w, 56); v[3] = U16(w, 44);
	v[4] = I32(w, 16); v[5] = I32(w, 52);
	v[6] = I32(w, 24); v[7] = I32(w, 28);
	v[8] = U16(w, 38); v[9] = U16(w, 40); v[10] = n;
	for (int i = 0; i < n; ++i) {
		v[11 + 2*i] = I32(w, kAttackFixed + i*kAttackDam);
		v[12 + 2*i] = I32(w, kAttackFixed + i*kAttackDam + 4);
	}
}

template <typename T>
int InAttackAs(const char* w, int n, char* out, int outCap, int* outSize, unsigned short op)
{
	auto* m = Begin<T>(w, out, outCap, outSize);
	if (!m)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	CountNonZero(w, 12, 16); // FakeExp: the server never writes it
	m->FakeExp = 0;
	m->ReqMp = I16(w, 58);
	m->CurrentExp = static_cast<long long>(U64(w, 24));
	m->Rsv = I16(w, 32);
	m->PosX = U16(w, 34);
	m->PosY = U16(w, 36);
	m->TargetX = U16(w, 38);
	m->TargetY = U16(w, 40);
	m->AttackerID = U16(w, 42);
	m->Progress = U16(w, 44);
	m->Motion = static_cast<char>(U8(w, 46));
	m->FlagLocal = static_cast<char>(U8(w, 47));
	m->DoubleCritical = static_cast<char>(U8(w, 48));
	m->SkillParm = static_cast<char>(U8(w, 49));
	m->CurrentMp = I32(w, 52);
	m->SkillIndex = I16(w, 56);
	for (int i = 0; i < n; ++i)
	{
		m->Dam[i].TargetID = NarrowUShort(I32(w, kAttackFixed + i * kAttackDam));
		m->Dam[i].Damage = I32(w, kAttackFixed + i * kAttackDam + 4);
	}
	RecordCombat(0, w, n);
	return WYD_DIALECT_TRANSLATED;
}

int InAttack(const char* w, int wireSize, char* out, int outCap, int* outSize, unsigned short op)
{
	const int body = wireSize - kAttackFixed;
	if (body < kAttackDam || body % kAttackDam)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	const int n = body / kAttackDam;
	if (n > AttackCapacity(op))
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	Count(WYD_STAT_IN_ATTACK);
	if (op == OpAttackOne)
		return InAttackAs<MSG_AttackOne>(w, n, out, outCap, outSize, op);
	if (op == OpAttackTwo)
		return InAttackAs<MSG_AttackTwo>(w, n, out, outCap, outSize, op);
	return InAttackAs<MSG_Attack>(w, n, out, outCap, outSize, op);
}

// The server's MSG_MessageBoxOk carries its own local notice code (handler/
// notice.go iota, which the server itself marks as a placeholder format), not a
// runtime message-table index, and is sent with Header.ID = conn, which the
// scenes ignore. It becomes a MessagePanel (ID 0) with a fixed text, so the
// reason for a refused login or action is shown instead of silently dropped.
const char* NoticeText(std::uint32_t code)
{
	static const char* const kTexts[] = {
		"Versao do cliente incompativel com o servidor.", // VersionMismatch
		"Login em andamento, aguarde.",                     // LoginNow
		"Senha incorreta 3 vezes. Aguarde para tentar.",    // 3WrongPass
		"Senha incorreta.",                                 // BadPass
		"Conta inexistente.",                               // NoAccount
		"Conta bloqueada.",                                 // Blocked
		"Selecione um personagem.",                         // SelectCharacter
		"Apagando personagem, aguarde.",                    // DeletingWait
		"Erro no banco de dados do servidor.",              // DBError
		"Nao e possivel largar aqui.",                      // CantDropHere
		"Indisponivel com a loja aberta.",                  // CantAutoTrade
		"Jogador nao conectado.",                           // NotConnected
		"O jogador recusa sussurros.",                      // DenyWhisper
		"Entrada negada pelo servidor.",                    // BillingDenied
		"Limite do banco atingido.",                        // CargoFull
		"Requisitos do item nao atendidos.",                // ReqNotMet
		"Ja existe um efeito desse tipo ativo.",            // CantEatMore
		"Skill de outra classe.",                           // OtherClassSkill
		"Pontos de skill insuficientes.",                   // NotEnoughSkillPoint
		"Apenas uma skill desse grupo pode ser aprendida.", // OnlyOneEighthSkill
		"Aprenda as skills anteriores primeiro.",           // LearnPrereq
		"Skill ja aprendida.",                              // AlreadyLearned
		"Ouro insuficiente.",                               // NotEnoughCoin
		"Limite de pontos atingido.",                       // MaxPoint
		"Apenas em equipamentos.",                          // OnlyToEquips
		"Nao e possivel refinar mais.",                     // CantRefineMore
		"O refinamento falhou.",                            // FailToRefine
		"Refinamento bem-sucedido.",                        // RefineSuccess
		"O ovo chocou.",                                    // Incubated
		"Aguarde a incubacao.",                             // IncuWaitMore
		"A montaria subiu de nivel.",                       // MountLevel
		"Nao ha espaco no inventario.",                     // NoEmptySlot
		"As duas bolsas ja estao ativas.",                  // MaxBag
		"E preciso ter a chave.",                           // NoKey
	};
	return code < sizeof(kTexts) / sizeof(kTexts[0]) ? kTexts[code] : nullptr;
}

int InMessageBoxOk(const char* w, char* out, int outCap, int* outSize)
{
	auto* m = Begin<MSG_MessagePanel>(w, out, outCap, outSize);
	if (!m)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, OpMessageBoxOk);
	m->Header.Type = OpMessagePanel;
	m->Header.ID = 0;
	const std::uint32_t code = U32(w, 12);
	if (const char* text = NoticeText(code))
		std::snprintf(m->String, sizeof(m->String), "%s", text);
	else
		std::snprintf(m->String, sizeof(m->String), "Aviso do servidor (%u).", static_cast<unsigned>(code));
	return WYD_DIALECT_TRANSLATED;
}

bool ItemSlotVisible(int place, int slot)
{
	switch (place)
	{
	case 0: return slot < kEquipSlots;
	case 1: return slot < kCarryVisible;
	case 2: return slot < kCargoVisible;
	default: return false;
	}
}

// Echo of a slot swap: the runtime applies the move from this frame
// (OnPacketSwapItem); it never predicts it locally.
int InSwapItem(const char* w, char* out, int outCap, int* outSize)
{
	const int t0 = U8(w, 12), p0 = U8(w, 13), t1 = U8(w, 14), p1 = U8(w, 15);
	if (!ItemSlotVisible(t0, p0) || !ItemSlotVisible(t1, p1))
		return Fail(WYD_STAT_IN_DROP_RANGE, 0, OpSwapItem);
	const std::uint32_t warp = U32(w, 16);
	auto* m = Begin<MSG_SwapItem>(w, out, outCap, outSize);
	if (!m)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, OpSwapItem);
	m->SourType = static_cast<char>(t0);
	m->SourPos = static_cast<char>(p0);
	m->DestType = static_cast<char>(t1);
	m->DestPos = static_cast<char>(p1);
	m->TargetID = NarrowUShort(warp);
	return WYD_DIALECT_TRANSLATED;
}

// Echo of an equip-by-use (handler/item.go equipItem). The runtime has no
// consumer for 0x373 and ignores it; it is delivered in the runtime's layout
// so the frame is neither hidden nor misread.
int InUseItem(const char* w, char* out, int outCap, int* outSize)
{
	auto* m = Begin<MSG_UseItem>(w, out, outCap, outSize);
	if (!m)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, OpUseItem);
	m->SourType = I32(w, 12);
	m->SourPos = I32(w, 16);
	m->DestType = I32(w, 20);
	m->DestPos = I32(w, 24);
	m->GridX = U16(w, 28);
	m->GridY = U16(w, 30);
	m->ItemID = U16(w, 32);
	return WYD_DIALECT_TRANSLATED;
}

// Chat line (0x333). A player's line is forwarded as the speaker sent it (140
// bytes from this runtime); server notices (sendChatText, sendNPCChatText, /nick)
// are the bare NUL-terminated text. Both become the runtime's fixed layout with
// a terminator the consumers can rely on.
int InMessageChat(const char* w, int wireSize, char* out, int outCap, int* outSize)
{
	if (wireSize > static_cast<int>(sizeof(MSG_MessageChat)))
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, OpMessageChat);
	auto* m = Begin<MSG_MessageChat>(w, out, outCap, outSize);
	if (!m)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, OpMessageChat);
	std::memcpy(m->String, w + kHeader, wireSize - kHeader);
	m->String[sizeof(m->String) - 1] = 0;
	return WYD_DIALECT_TRANSLATED;
}

// Whisper (0x334): the server forwards the sender's payload (MobName + text,
// any length >= 16 body bytes); normalize to the 160-byte runtime layout.
int InMessageWhisper(const char* w, int wireSize, char* out, int outCap, int* outSize)
{
	if (wireSize < kWhisperFixed || wireSize > kWhisper)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, OpMessageWhisper);
	auto* m = Begin<MSG_MessageWhisper>(w, out, outCap, outSize);
	if (!m)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, OpMessageWhisper);
	std::memcpy(out + kHeader, w + kHeader, wireSize - kHeader);
	m->MobName[sizeof(m->MobName) - 1] = 0;
	m->String[sizeof(m->String) - 1] = 0;
	return WYD_DIALECT_TRANSLATED;
}

// Account cargo gold (0x339): 57 bytes on the wire, StandardParm(coin) in the
// runtime (OnPacketUpdateCargoCoin). The server writes the coin at @12 and
// marks that offset UNVERIFIED; ADR 008 keeps it a hypothesis until a run
// compares the bank display with the server log.
int InUpdateCargoCoin(const char* w, char* out, int outCap, int* outSize)
{
	auto* m = Begin<MSG_STANDARDPARM>(w, out, outCap, outSize);
	if (!m)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, OpUpdateCargoCoin);
	m->Parm = I32(w, 12);
	return WYD_DIALECT_TRANSLATED;
}

int InParty(const char* w, int size, char* out, int cap, int* outSize, unsigned short op)
{
	const int want = op == OpReqParty ? 48 : op == OpAddParty ? 40 : 16;
	if (size != want) return Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	if (op == OpRemoveParty)
	{
		const int id = I16(w, 12);
		if (id < 0 || id >= 1000) return Fail(WYD_STAT_IN_DROP_RANGE, 0, op);
		auto* m = Begin<MSG_STANDARDPARM>(w, out, cap, outSize);
		if (!m) return Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
		m->Parm = id; // ignore legacy tail padding; do not read it as high ID bits
		return WYD_DIALECT_TRANSLATED;
	}
	const int id = U16(w, 20), level = U16(w, 14), maxHp = U16(w, 16), hp = U16(w, 18);
	const int leader = U16(w, 12);
	if (id <= 0 || id >= 1000 || level > 32767 || maxHp > 32767 || hp > 32767 ||
		(op == OpAddParty && leader != id && leader != 30000) ||
		(op == OpReqParty && (U8(w, 12) > 3 || U8(w, 13) != 0)))
		return Fail(WYD_STAT_IN_DROP_RANGE, 0, op);
	PARTY* p;
	if (op == OpReqParty)
	{
		auto* m = Begin<MSG_REQParty>(w, out, cap, outSize);
		if (!m) return Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
		p = &m->Leader;
		p->Class = U8(w, 12);
	}
	else
	{
		auto* m = Begin<MSG_AddParty>(w, out, cap, outSize);
		if (!m) return Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
		p = &m->Party;
		p->Class = -1; // absent on wire; scene may resolve it from the real entity
		p->PartyIndex = leader == id ? 0 : 1;
	}
	p->ID = id;
	p->Level = static_cast<short>(level);
	p->MaxHp = static_cast<short>(maxHp);
	p->Hp = static_cast<short>(hp);
	std::memcpy(p->Name, w + 22, 16);
	return WYD_DIALECT_TRANSLATED;
}

// MSG_Trade: the server packs it (154 bytes: money @147, MyCheck @151, opponent
// @152); the runtime's MSVC-aligned struct has 156 (@148, @152, @154). Items
// (@12, 15 x 8) and CarryPos (@132, 15 x char, -1 = empty) sit at the same offsets.
constexpr int kTradeWire = 154;
constexpr int kTradeMaxMoney = 2000000000;

bool TradeFieldsValid(const char* p, int money, int check, int opponent)
{
	if (money < 0 || money > kTradeMaxMoney || (check != 0 && check != 1) || opponent <= 0 || opponent >= 1000)
		return false;
	for (int i = 0; i < 15; ++i)
	{
		const int pos = static_cast<signed char>(p[132 + i]);
		const int index = I16(p, 12 + i * 8);
		if (pos < -1 || pos >= MAX_CARRY || index < 0 || (pos == -1 && index != 0))
			return false;
	}
	return true;
}

int InTrade(const char* w, int size, char* out, int cap, int* outSize)
{
	if (size != kTradeWire) return Fail(WYD_STAT_IN_DROP_SIZE, 0, OpTrade);
	if (!TradeFieldsValid(w, I32(w, 147), U8(w, 151), U16(w, 152)))
		return Fail(WYD_STAT_IN_DROP_RANGE, 0, OpTrade);
	auto* m = Begin<MSG_Trade>(w, out, cap, outSize);
	if (!m) return Fail(WYD_STAT_IN_DROP_SIZE, 0, OpTrade);
	std::memcpy(m->Item, w + 12, sizeof(m->Item));
	std::memcpy(m->CarryPos, w + 132, sizeof(m->CarryPos));
	m->TradeMoney = I32(w, 147);
	m->MyCheck = static_cast<char>(U8(w, 151));
	m->OpponentID = U16(w, 152);
	return WYD_DIALECT_TRANSLATED;
}

int PassIfSize(int wireSize, int want, unsigned short op)
{
	if (wireSize != want)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	Count(WYD_STAT_IN_PASS);
	return WYD_DIALECT_PASS;
}

int Translated(int result)
{
	if (result == WYD_DIALECT_TRANSLATED)
		Count(WYD_STAT_IN_TRANSLATED);
	return result;
}
} // namespace

int WydDialectInbound(const char* wire, int wireSize, char* out, int outCap, int* outSize)
{
	*outSize = 0;
	if (!wire || wireSize < kHeader)
		return Fail(WYD_STAT_IN_DROP_SIZE, 0, 0);
	for (int i = 4; i < wireSize; ++i)
		g_inHash = (g_inHash ^ U8(wire, i)) * 16777619u;
	++g_inFrames;
	const unsigned short op = U16(wire, 4);
	auto exact = [&](int want) { return wireSize == want; };

	switch (op)
	{
	case OpReqParty:
	case OpAddParty:
	case OpRemoveParty:
		return Translated(InParty(wire, wireSize, out, outCap, outSize, op));
	case OpTrade:
		return Translated(InTrade(wire, wireSize, out, outCap, outSize));
	case OpQuitTrade: // MSG_STANDARD signals; consumers read only the header
	case OpCNFCheck:
		return PassIfSize(wireSize, kHeader, op);
	case OpCNFAccountLogin:
		return exact(kCNFAccountLogin) ? Translated(InCNFAccountLogin(wire, out, outCap, outSize))
			: Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	case OpCNFNewCharacter:
	case OpCNFDeleteCharacter:
		return exact(kCNFSelChar) ? Translated(InCNFSelChar(wire, out, outCap, outSize, op))
			: Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	case OpCNFCharacterLogin:
		return exact(kCNFCharacterLogin) ? Translated(InCNFCharacterLogin(wire, out, outCap, outSize))
			: Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	case OpCreateMob:
		return exact(kCreateMob) ? Translated(InCreateMob(wire, out, outCap, outSize))
			: Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	case OpCreateMobTrade:
		return exact(kCreateMobTrade) ? Translated(InCreateMobTrade(wire, out, outCap, outSize))
			: Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	case OpUpdateScore:
		return exact(kUpdateScore) ? Translated(InUpdateScore(wire, out, outCap, outSize))
			: Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	case OpSendAffect:
		return exact(kSendAffect) ? Translated(InSendAffect(wire, out, outCap, outSize))
			: Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	case OpUpdateEquip:
		return exact(kUpdateEquip) ? Translated(InUpdateEquip(wire, out, outCap, outSize))
			: Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	case OpSetHpDam:
		return exact(kSetHpDam) ? Translated(InSetHpDam(wire, out, outCap, outSize))
			: Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	case OpAttack:
	case OpAttackOne:
	case OpAttackTwo:
		return Translated(InAttack(wire, wireSize, out, outCap, outSize, op));
	case OpRemoveMob:
	case OpPKInfo:        // StandardParm; the runtime has no consumer
	case OpUpdateWeather: // StandardParm (int32 weather)
		return PassIfSize(wireSize, 16, op);
	case OpSetHpMp:
		return PassIfSize(wireSize, 28, op);
	case OpMotion: // same layout (static_assert above)
		return PassIfSize(wireSize, static_cast<int>(sizeof(MSG_Motion)), op);
	case OpShopList: // same layout (static_assert above); ShopType 3 = skill master
		return PassIfSize(wireSize, static_cast<int>(sizeof(MSG_ShopList)), op);
	case OpSendItem:
		return PassIfSize(wireSize, 24, op);
	case OpUpdateCarry: // same layout (static_assert above)
		return PassIfSize(wireSize, kUpdateCarry, op);
	case OpSwapItem:
		return exact(kSwapItem) ? Translated(InSwapItem(wire, out, outCap, outSize))
			: Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	case OpUseItem:
		return exact(kUseItemWire) ? Translated(InUseItem(wire, out, outCap, outSize))
			: Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	case OpUpdateEtc:
		return PassIfSize(wireSize, 48, op);
	case OpMessageChat:
		return Translated(InMessageChat(wire, wireSize, out, outCap, outSize));
	case OpMessageWhisper:
		return Translated(InMessageWhisper(wire, wireSize, out, outCap, outSize));
	case OpUpdateCargoCoin:
		return exact(kUpdateCargoCoin) ? Translated(InUpdateCargoCoin(wire, out, outCap, outSize))
			: Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	case OpBuy: // echo of this runtime's 24-byte request, new gold @20 (OnPacketBuy ignores it)
		return PassIfSize(wireSize, kBuy, op);
	case OpSell: // echo of the 18-byte request; OnPacketSell reads fields up to @17
		return PassIfSize(wireSize, kSell, op);
	case OpDeposit: // echo of StandardParm(amount); the runtime applies it as a delta
	case OpWithdraw:
		return PassIfSize(wireSize, 16, op);
	case OpAction:
	case OpActionStop:
	case OpAction2:
		return PassIfSize(wireSize, 52, op);
	case OpMessagePanel:
		return PassIfSize(wireSize, 140, op);
	case OpMessageBoxOk: // server-local notice code (StandardParm)
		return exact(16) ? Translated(InMessageBoxOk(wire, out, outCap, outSize))
			: Fail(WYD_STAT_IN_DROP_SIZE, 0, op);
	case OpCNFCharacterLogout:
	case OpCharacterLoginFail:
	case OpNewCharacterFail:
	case OpDeleteCharacterFail:
	case OpAlreadyPlaying:
	case OpAlreadyPlaying2:
	case OpAccountSecure:
	case OpAccountSecureFail:
		// Header-only replies; consumers read only Type.
		return PassIfSize(wireSize, kHeader, op);
	default:
		return Fail(WYD_STAT_IN_DROP_UNKNOWN, 0, op);
	}
}

namespace
{
int OutFail(int stat, unsigned short op) { return Fail(stat, 1, op); }

int OutPass(int msgSize, int want, unsigned short op)
{
	if (msgSize != want)
		return OutFail(WYD_STAT_OUT_DROP_SIZE, op);
	Count(WYD_STAT_OUT_PASS);
	return WYD_DIALECT_PASS;
}

int OutDone(int* outSize, int size)
{
	*outSize = size;
	Count(WYD_STAT_OUT_TRANSLATED);
	return WYD_DIALECT_TRANSLATED;
}
} // namespace

int WydDialectOutbound(const char* msg, int msgSize, char* out, int outCap, int* outSize)
{
	*outSize = 0;
	if (!msg || msgSize < kHeader)
		return OutFail(WYD_STAT_OUT_DROP_SIZE, 0);
	const unsigned short op = U16(msg, 4);

	switch (op)
	{
	case OpReqParty:
	{
		if (msgSize != sizeof(MSG_REQParty) || outCap < 48) return OutFail(WYD_STAT_OUT_DROP_SIZE, op);
		const auto* m = reinterpret_cast<const MSG_REQParty*>(msg);
		if (m->TargetID <= 0 || m->TargetID >= 1000 || m->Leader.ID <= 0 || m->Leader.ID >= 1000 ||
			m->Leader.ID != U16(msg, 6) || m->Leader.Class < -1 || m->Leader.Class > 3 || m->Leader.PartyIndex != 0)
			return OutFail(WYD_STAT_OUT_DROP_RANGE, op);
		std::memset(out, 0, 48);
		std::memcpy(out, msg, 12);
		Put16(out, 0, 48);
		// Runtime sends body mesh - 1 (-1 for male bodies), as 7662 does; the server
		// ignores @12 and re-encodes its own class in the forwarded invite.
		out[12] = m->Leader.Class;
		Put16(out, 14, static_cast<unsigned short>(m->Leader.Level));
		Put16(out, 16, static_cast<unsigned short>(m->Leader.MaxHp));
		Put16(out, 18, static_cast<unsigned short>(m->Leader.Hp));
		Put16(out, 20, m->Leader.ID);
		std::memcpy(out + 22, m->Leader.Name, 16);
		Put32(out, 40, m->TargetID); // server Unk is its primary destination
		Put16(out, 44, m->TargetID);
		return OutDone(outSize, 48);
	}
	case OpAcceptParty:
	{
		if (msgSize != sizeof(MSG_CNFParty2) || outCap < 32) return OutFail(WYD_STAT_OUT_DROP_SIZE, op);
		const auto* m = reinterpret_cast<const MSG_CNFParty2*>(msg);
		if (m->LeaderID <= 0 || m->LeaderID >= 1000) return OutFail(WYD_STAT_OUT_DROP_RANGE, op);
		std::memset(out, 0, 32);
		std::memcpy(out, msg, 12);
		Put16(out, 0, 32);
		Put16(out, 12, m->LeaderID);
		std::memcpy(out + 14, m->LeaderName, 16);
		return OutDone(outSize, 32);
	}
	case OpTrade:
	{
		if (msgSize != sizeof(MSG_Trade) || outCap < kTradeWire) return OutFail(WYD_STAT_OUT_DROP_SIZE, op);
		const auto* m = reinterpret_cast<const MSG_Trade*>(msg);
		if (!TradeFieldsValid(msg, m->TradeMoney, static_cast<unsigned char>(m->MyCheck), m->OpponentID))
			return OutFail(WYD_STAT_OUT_DROP_RANGE, op);
		std::memset(out, 0, kTradeWire);
		std::memcpy(out, msg, 12);
		Put16(out, 0, kTradeWire);
		std::memcpy(out + 12, m->Item, sizeof(m->Item));
		std::memcpy(out + 132, m->CarryPos, sizeof(m->CarryPos));
		Put32(out, 147, static_cast<std::uint32_t>(m->TradeMoney));
		out[151] = m->MyCheck;
		Put16(out, 152, m->OpponentID);
		return OutDone(outSize, kTradeWire);
	}
	case OpQuitTrade:
		return OutPass(msgSize, kHeader, op);
	case OpRemoveParty:
		if (msgSize != 16) return OutFail(WYD_STAT_OUT_DROP_SIZE, op);
		if (I32(msg, 12) < 0 || I32(msg, 12) >= 1000) return OutFail(WYD_STAT_OUT_DROP_RANGE, op);
		return OutPass(msgSize, 16, op);
	case OpAccountLogin:
	{
		if (msgSize != static_cast<int>(sizeof(MSG_AccountLogin)) || outCap < kAccountLoginWire)
			return OutFail(WYD_STAT_OUT_DROP_SIZE, op);
		if (g_clientVersion <= 0)
			return OutFail(WYD_STAT_OUT_DROP_NO_VERSION, op);
		const auto* in = reinterpret_cast<const MSG_AccountLogin*>(msg);
		std::memset(out, 0, kAccountLoginWire);
		std::memcpy(out, msg, kHeader);
		std::memcpy(out + 12, in->AccountPass, 12);
		std::memcpy(out + 24, in->AccountName, 16);
		// @40..91 reserved: zero (the runtime's TID is not part of this dialect).
		Put32(out, 92, static_cast<std::uint32_t>(g_clientVersion));
		Put32(out, 96, static_cast<std::uint32_t>(in->Force));
		for (int i = 0; i < 4; ++i)
			Put32(out, 100 + i * 4, in->Mac[i]);
		return OutDone(outSize, kAccountLoginWire);
	}
	case OpCharacterLogin:
	{
		// The runtime appends SecretCode[16]; the server contract is 20 bytes.
		if (msgSize != static_cast<int>(sizeof(MSG_CharacterLogin)) || outCap < kCharacterLoginWire)
			return OutFail(WYD_STAT_OUT_DROP_SIZE, op);
		const auto* in = reinterpret_cast<const MSG_CharacterLogin*>(msg);
		std::memset(out, 0, kCharacterLoginWire);
		std::memcpy(out, msg, kHeader);
		Put32(out, 12, static_cast<std::uint32_t>(in->Slot));
		Put32(out, 16, static_cast<std::uint32_t>(in->Force));
		return OutDone(outSize, kCharacterLoginWire);
	}
	case OpDeleteCharacter:
	{
		if (msgSize != static_cast<int>(sizeof(MSG_DeleteCharacter)) || outCap < kDeleteCharacterWire)
			return OutFail(WYD_STAT_OUT_DROP_SIZE, op);
		const auto* in = reinterpret_cast<const MSG_DeleteCharacter*>(msg);
		// Server password field is 12 bytes; a longer password cannot be sent.
		for (int i = 12; i < 16; ++i)
			if (in->Password[i])
				return OutFail(WYD_STAT_OUT_DROP_RANGE, op);
		std::memset(out, 0, kDeleteCharacterWire);
		std::memcpy(out, msg, kHeader);
		Put32(out, 12, static_cast<std::uint32_t>(in->Slot));
		std::memcpy(out + 16, in->MobName, 16);
		std::memcpy(out + 32, in->Password, 12);
		return OutDone(outSize, kDeleteCharacterWire);
	}
	case OpAccountSecure:
	{
		// Runtime: ItemPassWord[16] + State char. Server: NumericToken[6],
		// reserved[10], ChangeNumeric int32 (0 verify, 1 set/change).
		if (msgSize != static_cast<int>(sizeof(MSG_CHARPASSWORD)) || outCap < kAccountSecureWire)
			return OutFail(WYD_STAT_OUT_DROP_SIZE, op);
		const auto* in = reinterpret_cast<const MSG_CHARPASSWORD*>(msg);
		for (int i = kPinDigits; i < 16; ++i)
			if (in->ItemPassWord[i])
				return OutFail(WYD_STAT_OUT_DROP_RANGE, op);
		std::memset(out, 0, kAccountSecureWire);
		std::memcpy(out, msg, kHeader);
		std::memcpy(out + 12, in->ItemPassWord, kPinDigits);
		Put32(out, 28, static_cast<std::uint32_t>(static_cast<int>(in->State)));
		return OutDone(outSize, kAccountSecureWire);
	}
	case OpAttack:
	case OpAttackOne:
	case OpAttackTwo:
	{
		// The runtime struct is chosen by size (168/72/80, trailing alignment
		// included), not by opcode: the melee path (TMHuman.cpp, nSize =
		// sizeof(MSG_Attack)) sends 0x039D with the full 13-target struct.
		// The server ignores the opcode here and derives N from the length
		// (MsgAttackBody.Decode), so the opcode is kept as sent. Every field
		// is rewritten by offset so padding never reaches the server, where
		// Dam[].TargetID is an i32 and would absorb it.
		const int n = msgSize == static_cast<int>(sizeof(MSG_Attack)) ? kMaxTarget
			: msgSize == static_cast<int>(sizeof(MSG_AttackTwo)) ? 2
			: msgSize == static_cast<int>(sizeof(MSG_AttackOne)) ? 1 : 0;
		const int wireSize = kAttackFixed + n * kAttackDam;
		if (n == 0 || outCap < wireSize)
			return OutFail(WYD_STAT_OUT_DROP_SIZE, op);
		const auto* in = reinterpret_cast<const MSG_Attack*>(msg); // shared prefix
		std::memset(out, 0, wireSize);
		std::memcpy(out, msg, kHeader);
		out[0] = static_cast<char>(wireSize & 0xFF);
		out[1] = static_cast<char>(wireSize >> 8);
		Put32(out, 12, static_cast<std::uint32_t>(in->FakeExp));
		// @16 is the server's CurrentHp (overwritten by it) and @58 its ReqMp:
		// the runtime's ReqMp has no server input, so both stay zero.
		Put32(out, 24, static_cast<std::uint32_t>(in->CurrentExp));
		Put32(out, 28, static_cast<std::uint32_t>(static_cast<unsigned long long>(in->CurrentExp) >> 32));
		Put16(out, 32, static_cast<std::uint16_t>(in->Rsv));
		Put16(out, 34, in->PosX);
		Put16(out, 36, in->PosY);
		Put16(out, 38, in->TargetX);
		Put16(out, 40, in->TargetY);
		Put16(out, 42, in->AttackerID);
		Put16(out, 44, in->Progress);
		out[46] = in->Motion;
		out[47] = in->FlagLocal;
		out[48] = in->DoubleCritical;
		out[49] = in->SkillParm;
		Put32(out, 52, static_cast<std::uint32_t>(in->CurrentMp));
		Put16(out, 56, static_cast<std::uint16_t>(in->SkillIndex));
		for (int i = 0; i < n; ++i)
		{
			Put32(out, kAttackFixed + i * kAttackDam, in->Dam[i].TargetID);
			Put32(out, kAttackFixed + i * kAttackDam + 4, static_cast<std::uint32_t>(in->Dam[i].Damage));
		}
		Count(WYD_STAT_OUT_ATTACK);
		RecordCombat(1, out, n);
		return OutDone(outSize, wireSize);
	}
	case OpSwapItem:
	{
		// Drag and drop between equip/carry/cargo cells (SGrid.cpp SwapItem).
		if (msgSize != static_cast<int>(sizeof(MSG_SwapItem)) || outCap < kSwapItem)
			return OutFail(WYD_STAT_OUT_DROP_SIZE, op);
		const auto* in = reinterpret_cast<const MSG_SwapItem*>(msg);
		const int t0 = static_cast<unsigned char>(in->SourType), p0 = static_cast<unsigned char>(in->SourPos);
		const int t1 = static_cast<unsigned char>(in->DestType), p1 = static_cast<unsigned char>(in->DestPos);
		if (!ItemSlotVisible(t0, p0) || !ItemSlotVisible(t1, p1))
			return OutFail(WYD_STAT_OUT_DROP_RANGE, op);
		std::memset(out, 0, kSwapItem);
		std::memcpy(out, msg, kHeader);
		out[12] = static_cast<char>(t0);
		out[13] = static_cast<char>(p0);
		out[14] = static_cast<char>(t1);
		out[15] = static_cast<char>(p1);
		Put32(out, 16, in->TargetID); // cargo NPC id, zero-extended; padding never sent
		return OutDone(outSize, kSwapItem);
	}
	case OpUseItem:
	{
		// Right-click use/equip (TMFieldScene::UseItem). The server decides the
		// outcome; the runtime's local stack decrement is corrected by 0x182.
		if (msgSize != static_cast<int>(sizeof(MSG_UseItem)) || outCap < kUseItemWire)
			return OutFail(WYD_STAT_OUT_DROP_SIZE, op);
		const auto* in = reinterpret_cast<const MSG_UseItem*>(msg);
		std::memset(out, 0, kUseItemWire);
		std::memcpy(out, msg, kHeader);
		out[0] = static_cast<char>(kUseItemWire);
		out[1] = 0;
		Put32(out, 12, static_cast<std::uint32_t>(in->SourType));
		Put32(out, 16, static_cast<std::uint32_t>(in->SourPos));
		Put32(out, 20, static_cast<std::uint32_t>(in->DestType));
		Put32(out, 24, static_cast<std::uint32_t>(in->DestPos));
		Put16(out, 28, in->GridX);
		Put16(out, 30, in->GridY);
		Put16(out, 32, in->ItemID);
		return OutDone(outSize, kUseItemWire);
	}
	case OpDeleteItem:
	{
		// Item dropped on the trash grid and confirmed (TMFieldScene message box
		// 740, SGrid.cpp GRID_DELETE). The runtime has already removed it from
		// its grid, so dropping this frame left the server holding an item the
		// player no longer saw. The server clears the slot and answers 0x182.
		if (msgSize != static_cast<int>(sizeof(MSG_STANDARDPARM2)) || outCap < kDeleteItem)
			return OutFail(WYD_STAT_OUT_DROP_SIZE, op);
		const auto* in = reinterpret_cast<const MSG_STANDARDPARM2*>(msg);
		if (in->Parm1 < 0 || in->Parm1 >= kCarryVisible)
			return OutFail(WYD_STAT_OUT_DROP_RANGE, op);
		std::memcpy(out, msg, kHeader);
		Put32(out, 12, static_cast<std::uint32_t>(in->Parm1));
		Put32(out, 16, static_cast<std::uint32_t>(in->Parm2));
		return OutDone(outSize, kDeleteItem);
	}
	case OpBuy:
	{
		// Buy from the open NPC shop (SGrid.cpp). Written by field so the
		// runtime's padding @18 never reaches the server, which echoes the
		// payload back with the new gold at @20.
		if (msgSize != static_cast<int>(sizeof(MSG_Buy)) || outCap < kBuy)
			return OutFail(WYD_STAT_OUT_DROP_SIZE, op);
		const auto* in = reinterpret_cast<const MSG_Buy*>(msg);
		std::memset(out, 0, kBuy);
		std::memcpy(out, msg, kHeader);
		Put16(out, 12, in->TargetID);
		Put16(out, 14, static_cast<std::uint16_t>(in->TargetCarryPos));
		Put16(out, 16, static_cast<std::uint16_t>(in->MyCarryPos));
		Put32(out, 20, static_cast<std::uint32_t>(in->Coin));
		return OutDone(outSize, kBuy);
	}
	case OpSell: // TargetID, MyType, MyPos (handler/shop.go sell); padding @18 dropped
		if (msgSize != static_cast<int>(sizeof(MSG_Sell)) || outCap < kSell)
			return OutFail(WYD_STAT_OUT_DROP_SIZE, op);
		std::memcpy(out, msg, kSell);
		out[0] = static_cast<char>(kSell);
		out[1] = 0;
		return OutDone(outSize, kSell);
	case OpDeposit: // StandardParm(amount) (handler/cargo.go)
	case OpWithdraw:
		return OutPass(msgSize, 16, op);
	case OpMessageChat: // String[128]; the server multicasts it unchanged
		return OutPass(msgSize, static_cast<int>(sizeof(MSG_MessageChat)), op);
	case OpMessageWhisper: // MobName[16] + String[128] + Color; also carries "/command"
		if (msgSize != static_cast<int>(sizeof(MSG_MessageWhisper)) || outCap < kWhisper)
			return OutFail(WYD_STAT_OUT_DROP_SIZE, op);
		std::memcpy(out, msg, kWhisper); // tail padding @158 dropped
		out[0] = static_cast<char>(kWhisper);
		out[1] = 0;
		return OutDone(outSize, kWhisper);
	case OpRestart: // header only (TMFieldScene recall after death / town)
		return OutPass(msgSize, kHeader, op);
	case OpReqMobByID: // StandardParm(mob id): unknown attacker, ask for CreateMob
		return OutPass(msgSize, 16, op);
	case OpDelayStart: // StandardParm; "return to town" box (TMFieldScene msg 11) before
		// Restart. The server has no route for it and only logs it, as it does
		// for the Windows client; dropping it here would hide nothing.
		return OutPass(msgSize, 16, op);
	case OpSetShortSkill: // Skill[20] (Basedef.h); server copies [0:4] bar + [4:20]
		// short skills (handler/skill.go setShortSkill), no reply. Same layout.
		return OutPass(msgSize, 32, op);
	case OpREQShopList: // click on a merchant NPC; server reads the u16 target only
		return OutPass(msgSize, static_cast<int>(sizeof(MSG_REQShopList)), op);
	case OpApplyBonus: // score/special points and, BonusType 2, learn skill 5000+idx
		// from the NPC in TargetID (handler/skill.go learnSkill); same layout.
		return OutPass(msgSize, static_cast<int>(sizeof(MSG_ApplyBonus)), op);
	case OpNewCharacter:
		return OutPass(msgSize, 36, op);
	case OpAction:
	case OpActionStop:
	case OpAction2:
		return OutPass(msgSize, 52, op);
	case OpCharacterLogout:
	case OpPing:
		return OutPass(msgSize, kHeader, op);
	case OpReqTeleport: // StandardParm(0); the server reads only the header
	case OpChangeCity:  // StandardParm(village); the server derives it from the position
		return OutPass(msgSize, 16, op);
	default:
		return OutFail(WYD_STAT_OUT_DROP_UNKNOWN, op);
	}
}

void WydDialectScrubOutbound(char* msg, int msgSize)
{
	if (!msg || msgSize < kHeader)
		return;
	volatile char* p = msg;
	switch (U16(msg, 4))
	{
	case OpAccountLogin:
		if (msgSize >= 24)
			for (int i = 12; i < 24; ++i)
				p[i] = 0;
		break;
	case OpDeleteCharacter:
		if (msgSize >= 48)
			for (int i = 32; i < 48; ++i)
				p[i] = 0;
		break;
	case OpAccountSecure:
		if (msgSize >= 28)
			for (int i = 12; i < 28; ++i)
				p[i] = 0;
		break;
	default:
		break;
	}
}

bool WydDialectIsCredential(const char* msg, int msgSize)
{
	if (!msg || msgSize < kHeader)
		return false;
	const unsigned short op = U16(msg, 4);
	return op == OpAccountLogin || op == OpDeleteCharacter || op == OpAccountSecure;
}

void WydDialectSetClientVersion(int version) { g_clientVersion = version; }
int WydDialectClientVersion() { return g_clientVersion; }

unsigned int WydDialectStatValue(int stat)
{
	return (stat >= 0 && stat < WYD_STAT_COUNT) ? g_stats[stat] : 0;
}

void WydDialectResetStats()
{
	std::memset(g_stats, 0, sizeof(g_stats));
	std::memset(g_drops, 0, sizeof(g_drops));
	g_inHash = 2166136261u;
	g_inFrames = 0;
}

unsigned int WydDialectInboundHash() { return g_inHash; }
unsigned int WydDialectInboundFrames() { return g_inFrames; }

int WydDialectDroppedCount(int outbound) { return g_drops[outbound ? 1 : 0].count; }

unsigned int WydDialectDroppedOpcode(int outbound, int index)
{
	const DropLog& d = g_drops[outbound ? 1 : 0];
	return (index >= 0 && index < d.count) ? d.opcode[index] : 0;
}

unsigned int WydDialectDroppedTimes(int outbound, int index)
{
	const DropLog& d = g_drops[outbound ? 1 : 0];
	return (index >= 0 && index < d.count) ? d.times[index] : 0;
}

void WydCombatClear() { for (auto& r : g_combat) r = CombatRing{}; }
void WydCombatEnable(int enabled) { WydCombatClear(); g_combatEnabled = enabled != 0; }
int WydCombatCount(int outbound) {
	const auto n = g_combat[outbound ? 1 : 0].total;
	return n < 64 ? static_cast<int>(n) : 64;
}
unsigned int WydCombatLost(int outbound) {
	const auto n = g_combat[outbound ? 1 : 0].total;
	return n > 64 ? n - 64 : 0;
}
int WydCombatValue(int outbound, int index, int field) {
	if (index < 0 || index >= WydCombatCount(outbound) || field < 0 || field >= 37) return 0;
	const auto& r = g_combat[outbound ? 1 : 0];
	const unsigned int start = r.total > 64 ? r.total % 64 : 0;
	return r.values[(start + index) % 64][field];
}

#if defined(__EMSCRIPTEN__)
#include <emscripten/emscripten.h>

// Page-facing controls and read-only diagnostics. None of them return payload.
extern "C"
{
EMSCRIPTEN_KEEPALIVE void wyd_combat_enable(int enabled) { WydCombatEnable(enabled); }
EMSCRIPTEN_KEEPALIVE void wyd_combat_clear() { WydCombatClear(); }
EMSCRIPTEN_KEEPALIVE int wyd_combat_count(int outbound) { return WydCombatCount(outbound); }
EMSCRIPTEN_KEEPALIVE unsigned int wyd_combat_lost(int outbound) { return WydCombatLost(outbound); }
EMSCRIPTEN_KEEPALIVE int wyd_combat_value(int outbound, int index, int field) { return WydCombatValue(outbound, index, field); }
EMSCRIPTEN_KEEPALIVE void wyd_net_set_client_version(int version) { WydDialectSetClientVersion(version); }
EMSCRIPTEN_KEEPALIVE int wyd_net_client_version() { return WydDialectClientVersion(); }
EMSCRIPTEN_KEEPALIVE unsigned int wyd_net_stat(int stat) { return WydDialectStatValue(stat); }
EMSCRIPTEN_KEEPALIVE void wyd_net_reset_stats() { WydDialectResetStats(); }
EMSCRIPTEN_KEEPALIVE int wyd_net_dropped_count(int outbound) { return WydDialectDroppedCount(outbound); }
EMSCRIPTEN_KEEPALIVE unsigned int wyd_net_dropped_opcode(int outbound, int i) { return WydDialectDroppedOpcode(outbound, i); }
EMSCRIPTEN_KEEPALIVE unsigned int wyd_net_dropped_times(int outbound, int i) { return WydDialectDroppedTimes(outbound, i); }
EMSCRIPTEN_KEEPALIVE unsigned int wyd_net_inbound_hash() { return WydDialectInboundHash(); }
EMSCRIPTEN_KEEPALIVE unsigned int wyd_net_inbound_frames() { return WydDialectInboundFrames(); }
}
#endif
