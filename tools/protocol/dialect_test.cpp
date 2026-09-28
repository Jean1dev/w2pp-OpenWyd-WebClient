// Field-by-field test of client/dialect/WydDialect.cpp on the wasm32 ABI.
// Built and run by tools/protocol/run_dialect_test.py (em++ -> node).
//
// Frames come from tools/protocol/gen_fixtures.py (explicit offsets; checked
// byte-for-byte against the Go encoders by zz_ext_dialect_test.go). The
// expected values below are written by hand from the same logical data: they
// are this test's oracle, not output of the translator.
#include "WydDialect.h"
#include "Basedef.h"
#include "dialect_fixtures.h"

#include <cstdio>
#include <cstring>
#include <initializer_list>

static int g_failures = 0;
static int g_checks = 0;

#define CHECK(cond)                                                                 \
	do                                                                              \
	{                                                                               \
		++g_checks;                                                                 \
		if (!(cond))                                                                \
		{                                                                           \
			++g_failures;                                                           \
			std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);            \
		}                                                                           \
	} while (0)

static char g_out[WYD_DIALECT_MAX_FRAME];

template <size_t N>
static int In(const unsigned char (&frame)[N], int* size, int wireSize = static_cast<int>(N))
{
	return WydDialectInbound(reinterpret_cast<const char*>(frame), wireSize, g_out, sizeof(g_out), size);
}

static bool Name(const char* got, const char* want, int width = 16)
{
	char buf[17] = {};
	std::memcpy(buf, got, width);
	return std::strcmp(buf, want) == 0;
}

static void ItemIs(const STRUCT_ITEM& it, int index, int e0 = 0, int v0 = 0, int e1 = 0, int v1 = 0, int e2 = 0, int v2 = 0)
{
	CHECK(it.sIndex == index);
	CHECK(it.stEffect[0].cEffect == e0 && it.stEffect[0].cValue == v0);
	CHECK(it.stEffect[1].cEffect == e1 && it.stEffect[1].cValue == v1);
	CHECK(it.stEffect[2].cEffect == e2 && it.stEffect[2].cValue == v2);
}

static void TestAccountLogin()
{
	WydDialectResetStats();
	int size = 0;
	CHECK(In(k_in_cnf_account_login, &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == static_cast<int>(sizeof(MSG_CNFAccountLogin)));
	const auto& m = *reinterpret_cast<MSG_CNFAccountLogin*>(g_out);
	CHECK(m.Header.Type == 0x10A && m.Header.ID == 30002 && m.Header.Tick == 0x01020304);
	for (char c : m.SecretCode)
		CHECK(c == 0);
	const STRUCT_SELCHAR& s = m.SelChar;
	CHECK(s.HomeTownX[0] == 2100 && s.HomeTownY[0] == 2101);
	CHECK(s.HomeTownX[3] == 65535 && s.HomeTownY[3] == 1);
	CHECK(Name(s.MobName[0], "Guerreiro") && Name(s.MobName[1], "Maga"));
	CHECK(Name(s.MobName[2], "") && Name(s.MobName[3], "Cacadora12345"));
	CHECK(s.Score[0].Level == 398 && s.Score[0].MaxHp == 5000 && s.Score[0].Hp == 4999);
	CHECK(s.Score[0].MaxMp == 800 && s.Score[0].Mp == 799);
	CHECK(s.Score[0].Str == 200 && s.Score[0].Int == 50 && s.Score[0].Dex == 100 && s.Score[0].Con == 150);
	CHECK(s.Score[1].Level == 0 && s.Score[2].Level == 0 && s.Score[2].MaxHp == 0);
	CHECK(s.Score[3].Level == 32767 && s.Score[3].MaxHp == 2147483647 && s.Score[3].Hp == 1);
	CHECK(s.Score[3].Str == -1 && s.Score[3].Int == 32767 && s.Score[3].Dex == -32768);
	ItemIs(s.Equip[0][0], 1, 43, 5);
	ItemIs(s.Equip[0][15], 3500, 1, 2, 3, 4, 5, 6);
	ItemIs(s.Equip[0][16], 0);
	ItemIs(s.Equip[0][17], 0);
	ItemIs(s.Equip[1][0], 11);
	ItemIs(s.Equip[2][0], 0);
	ItemIs(s.Equip[3][0], 31);
	ItemIs(s.Equip[3][14], 6499, 255, 255, 0, 1, 1, 0);
	ItemIs(s.Equip[3][15], 0);
	CHECK(s.Guild[0] == 77 && s.Guild[3] == 65535 && s.Guild[2] == 0);
	CHECK(s.Coin[0] == 2000000000 && s.Coin[1] == 0 && s.Coin[3] == -1);
	CHECK(s.Exp[0] == (1LL << 32) + 123 && s.Exp[3] == 9000000000000000LL);
	ItemIs(m.Cargo[0], 400);
	ItemIs(m.Cargo[1], 0);
	ItemIs(m.Cargo[119], 401, 9, 9);
	ItemIs(m.Cargo[120], 402);
	ItemIs(m.Cargo[127], 403, 1, 1, 2, 2, 3, 3);
	CHECK(m.Coin == 123456789 && Name(m.AccountName, "fixture01"));
	CHECK(WydDialectStatValue(WYD_STAT_IN_TRANSLATED) == 1);
	CHECK(WydDialectStatValue(WYD_STAT_CARGO_HIDDEN) == 2);
	CHECK(WydDialectStatValue(WYD_STAT_UNMAPPED_NONZERO) == 0);

	// Level beyond the runtime's short: refused, not truncated.
	CHECK(In(k_in_cnf_account_login_level_overflow, &size) == WYD_DIALECT_DROP);
	CHECK(WydDialectStatValue(WYD_STAT_IN_DROP_RANGE) == 1);
	// Every wrong size of a translated frame is refused.
	CHECK(In(k_in_cnf_account_login, &size, 2007) == WYD_DIALECT_DROP);
	CHECK(In(k_in_cnf_account_login, &size, 11) == WYD_DIALECT_DROP);
	CHECK(WydDialectStatValue(WYD_STAT_IN_DROP_SIZE) == 2);
}

static void TestNewCharacter()
{
	int size = 0;
	CHECK(In(k_in_cnf_new_character, &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == static_cast<int>(sizeof(MSG_CNFNewCharacter)));
	const auto& m = *reinterpret_cast<MSG_CNFNewCharacter*>(g_out);
	CHECK(m.Header.Type == 0x110 && m.Header.ID == 30001);
	CHECK(Name(m.SelChar.MobName[0], "Guerreiro") && Name(m.SelChar.MobName[1], "Maga"));
	CHECK(Name(m.SelChar.MobName[3], "") && m.SelChar.Score[3].Level == 0);
	ItemIs(m.SelChar.Equip[1][0], 11);
	CHECK(m.SelChar.Exp[0] == (1LL << 32) + 123);
}

static void TestCharacterLogin()
{
	WydDialectResetStats();
	int size = 0;
	CHECK(In(k_in_cnf_character_login, &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == static_cast<int>(sizeof(MSG_CNFCharacterLogin)));
	const auto& m = *reinterpret_cast<MSG_CNFCharacterLogin*>(g_out);
	const STRUCT_MOB& mob = m.MOB;
	CHECK(m.Header.Type == 0x114 && m.Header.ID == 30000);
	CHECK(m.PosX == 2100 && m.PosY == 2101);
	CHECK(Name(mob.MobName, "Guerreiro", 12));
	CHECK(static_cast<unsigned char>(mob.MobName[12]) == 75);
	CHECK(mob.Clan == 7 && mob.Merchant == 0 && mob.Guild == 77 && mob.Class == 0);
	CHECK(mob.Coin == 55555 && mob.Exp == (1LL << 33) + 5);
	CHECK(mob.HomeTownX == 2090 && mob.HomeTownY == 2091);
	for (const STRUCT_SCORE* sc : {&mob.BaseScore, &mob.CurrentScore})
	{
		CHECK(sc->Level == 398 && sc->Ac == 120 && sc->Damage == 300);
		CHECK(sc->AttackRun == 0x34 && sc->Reserved == 0);
		CHECK(sc->MaxHp == 5000 && sc->MaxMp == 800 && sc->Hp == 4999 && sc->Mp == 799);
		CHECK(sc->Str == 200 && sc->Int == 50 && sc->Dex == 100 && sc->Con == 150);
		CHECK(sc->Special[0] == 1 && sc->Special[1] == 2 && sc->Special[2] == 3 && sc->Special[3] == 4);
	}
	ItemIs(mob.Equip[0], 1);
	ItemIs(mob.Equip[15], 3500, 1, 2, 3, 4, 5, 6);
	ItemIs(mob.Equip[16], 0);
	ItemIs(mob.Equip[17], 0);
	ItemIs(mob.Carry[0], 400);
	ItemIs(mob.Carry[63], 401, 7, 8);
	CHECK(mob.LearnedSkill[0] == 0x40000001u && mob.LearnedSkill[1] == 0);
	CHECK(mob.HasSoulSkill());
	CHECK(mob.Magic == 20 && mob.ScoreBonus == 5 && mob.SpecialBonus == 6 && mob.SkillBonus == 7);
	CHECK(mob.Critical == 8 && mob.SaveMana == 0 && mob.GuildLevel == 2);
	CHECK(mob.ShortSkill[0] == 1 && mob.ShortSkill[3] == 4);
	CHECK(mob.RegenHP == 10 && mob.RegenMP == 11);
	CHECK(mob.Resist[0] == 1 && mob.Resist[3] == 4);
	CHECK(mob.CurrentKill == 0 && mob.TotalKill == 0);
	CHECK(m.Slot == 1 && m.ClientID == 517 && m.Weather == 2);
	for (int i = 0; i < 16; ++i)
		CHECK(m.ShortSkill[i] == i);
	CHECK(m.Ext1.Data[0] == 0);
	CHECK(WydDialectStatValue(WYD_STAT_FIELD_ZEROED) == 0);
	CHECK(WydDialectStatValue(WYD_STAT_UNMAPPED_NONZERO) == 0);

	// A server Magic that does not fit the runtime's char is zeroed and counted.
	unsigned char big[sizeof(k_in_cnf_character_login)];
	std::memcpy(big, k_in_cnf_character_login, sizeof(big));
	big[16 + 784] = 200;
	CHECK(In(big, &size) == WYD_DIALECT_TRANSLATED);
	CHECK(reinterpret_cast<MSG_CNFCharacterLogin*>(g_out)->MOB.Magic == 0);
	CHECK(WydDialectStatValue(WYD_STAT_FIELD_ZEROED) == 1);
	// Bytes in the unmapped tail are reported.
	big[16 + 784] = 20;
	big[1500] = 1;
	CHECK(In(big, &size) == WYD_DIALECT_TRANSLATED);
	CHECK(WydDialectStatValue(WYD_STAT_UNMAPPED_NONZERO) == 1);
}

static void TestCreateMob()
{
	int size = 0;
	CHECK(In(k_in_create_mob_player, &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == 236);
	const auto& p = *reinterpret_cast<MSG_CreateMob*>(g_out);
	CHECK(p.PosX == 2100 && p.PosY == 2101 && p.MobID == 5);
	CHECK(Name(p.MobName, "Guerreiro", 12));
	CHECK(static_cast<unsigned char>(p.MobName[12]) == 75 && p.MobName[13] == 3);
	CHECK(static_cast<unsigned char>(p.MobName[14]) == 1 && p.MobName[15] == 2); // totkill 513
	CHECK(p.Equip[0] == 1 && p.Equip[15] == 3500 && p.Equip[16] == 0 && p.Equip[17] == 0);
	CHECK(p.Affect[0] == 0x0101 && p.Affect[31] == 0xFFFF && p.Affect[1] == 0);
	CHECK(p.Guild == 77 && p.GuildLevel == 1);
	CHECK(p.Score.Level == 398 && p.Score.AttackRun == 0x34 && p.Score.Hp == 4999);
	CHECK(p.CreateType == 2);
	CHECK(static_cast<unsigned char>(p.Equip2[0]) == 0x80 && p.Equip2[15] == 0x7F);
	CHECK(p.Equip2[16] == 0 && p.Equip2[17] == 0 && p.Nick[0] == 0 && p.Server == 0);

	CHECK(In(k_in_create_mob_npc, &size) == WYD_DIALECT_TRANSLATED);
	const auto& n = *reinterpret_cast<MSG_CreateMob*>(g_out);
	CHECK(n.MobID == 1234 && std::memcmp(n.MobName, "Ciclope_Arqueiro", 16) == 0);
	CHECK(n.Score.Reserved == 1 && n.Score.Level == 150 && n.Equip[0] == 222);
}

static void TestInboundPassAndDrop()
{
	WydDialectResetStats();
	int size = 0;
	unsigned char remove[16] = {16, 0, 0, 0, 0x65, 0x01, 0x10, 0x04};
	CHECK(In(remove, &size) == WYD_DIALECT_PASS);
	CHECK(In(remove, &size, 12) == WYD_DIALECT_DROP);
	unsigned char action[52] = {52, 0, 0, 0, 0x6C, 0x03};
	CHECK(In(action, &size) == WYD_DIALECT_PASS);
	unsigned char fail[12] = {12, 0, 0, 0, 0x19, 0x01};
	CHECK(In(fail, &size) == WYD_DIALECT_PASS);
	// UpdateScore: same opcode and size in both dialects, different Level and
	// tail semantics (docs/compatibility.md): not passed through.
	unsigned char score[152] = {152, 0, 0, 0, 0x36, 0x03};
	CHECK(In(score, &size) == WYD_DIALECT_DROP);
	CHECK(In(score, &size) == WYD_DIALECT_DROP);
	CHECK(WydDialectStatValue(WYD_STAT_IN_PASS) == 3);
	CHECK(WydDialectStatValue(WYD_STAT_IN_DROP_UNKNOWN) == 2);
	CHECK(WydDialectDroppedCount(0) == 2);
	CHECK(WydDialectDroppedOpcode(0, 1) == 0x336 && WydDialectDroppedTimes(0, 1) == 2);
	CHECK(WydDialectInboundFrames() == 6);
}

static void TestOutbound()
{
	WydDialectResetStats();
	char wire[WYD_DIALECT_MAX_FRAME];
	int size = 0;

	MSG_AccountLogin login{};
	login.Header.Type = 0x20D;
	login.Header.Tick = 0x01020304;
	std::strcpy(login.AccountPass, "segredo1");
	std::strcpy(login.AccountName, "fixture01");
	std::memset(login.TID, 'X', sizeof(login.TID));
	login.Version = 1758;
	login.Force = 1;
	login.Mac[0] = 1;
	login.Mac[1] = 2;
	login.Mac[2] = 3;
	login.Mac[3] = 0xDEADBEEF;

	WydDialectSetClientVersion(0);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&login), sizeof(login), wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	CHECK(WydDialectStatValue(WYD_STAT_OUT_DROP_NO_VERSION) == 1);

	WydDialectSetClientVersion(kClientVersion);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&login), sizeof(login), wire, sizeof(wire), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == 116 && std::memcmp(wire + 4, k_out_account_login + 4, 112) == 0);
	CHECK(WydDialectIsCredential(reinterpret_cast<char*>(&login), sizeof(login)));
	WydDialectScrubOutbound(reinterpret_cast<char*>(&login), sizeof(login));
	for (char c : login.AccountPass)
		CHECK(c == 0);
	CHECK(Name(login.AccountName, "fixture01"));

	MSG_CharacterLogin cl{};
	cl.Header.Type = 0x213;
	cl.Header.Tick = 0x01020304;
	cl.Slot = 2;
	std::strcpy(cl.SecretCode, "abc");
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&cl), sizeof(cl), wire, sizeof(wire), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == 20 && std::memcmp(wire + 4, k_out_character_login + 4, 16) == 0);

	MSG_DeleteCharacter del{};
	del.Header.Type = 0x211;
	del.Header.Tick = 0x01020304;
	del.Slot = 3;
	std::strcpy(del.MobName, "Cacadora12345");
	std::strcpy(del.Password, "12345678901");
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&del), sizeof(del), wire, sizeof(wire), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == 44 && std::memcmp(wire + 4, k_out_delete_character + 4, 40) == 0);
	std::strcpy(del.Password, "1234567890123");
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&del), sizeof(del), wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	CHECK(WydDialectStatValue(WYD_STAT_OUT_DROP_RANGE) == 1);
	CHECK(!WydDialectIsCredential(reinterpret_cast<char*>(&cl), sizeof(cl)));
	WydDialectScrubOutbound(reinterpret_cast<char*>(&del), sizeof(del));
	for (char c : del.Password)
		CHECK(c == 0);

	MSG_CHARPASSWORD pin{};
	pin.Header.Type = 0xFDE;
	pin.Header.Tick = 0x01020304;
	std::strcpy(pin.ItemPassWord, "123456");
	pin.State = 1;
	CHECK(WydDialectIsCredential(reinterpret_cast<char*>(&pin), sizeof(pin)));
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&pin), sizeof(pin), wire, sizeof(wire), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == 32 && std::memcmp(wire + 4, k_out_account_secure + 4, 28) == 0);
	std::strcpy(pin.ItemPassWord, "1234567");
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&pin), sizeof(pin), wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	WydDialectScrubOutbound(reinterpret_cast<char*>(&pin), sizeof(pin));
	for (char c : pin.ItemPassWord)
		CHECK(c == 0);

	MSG_NewCharacter nc{};
	nc.Header.Type = 0x20F;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&nc), sizeof(nc), wire, sizeof(wire), &size) == WYD_DIALECT_PASS);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&nc), sizeof(nc) - 4, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);

	// Chat (0x333) has a 96- vs 128-byte text divergence: not sent until mapped.
	char chat[140] = {static_cast<char>(140), 0, 0, 0, 0x33, 0x03};
	CHECK(WydDialectOutbound(chat, sizeof(chat), wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	CHECK(WydDialectStatValue(WYD_STAT_OUT_DROP_UNKNOWN) == 1);
	CHECK(WydDialectDroppedOpcode(1, WydDialectDroppedCount(1) - 1) == 0x333);
}

int main()
{
	TestAccountLogin();
	TestNewCharacter();
	TestCharacterLogin();
	TestCreateMob();
	TestInboundPassAndDrop();
	TestOutbound();
	std::printf("%d checks, %d failures\n", g_checks, g_failures);
	return g_failures == 0 ? 0 : 1;
}
