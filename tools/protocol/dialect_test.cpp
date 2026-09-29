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
	// Chat (0x333) has no verified layout yet: not passed through.
	unsigned char chat[108] = {108, 0, 0, 0, 0x33, 0x03};
	CHECK(In(chat, &size) == WYD_DIALECT_DROP);
	CHECK(In(chat, &size) == WYD_DIALECT_DROP);
	CHECK(WydDialectStatValue(WYD_STAT_IN_PASS) == 3);
	CHECK(WydDialectStatValue(WYD_STAT_IN_DROP_UNKNOWN) == 2);
	CHECK(WydDialectDroppedCount(0) == 2);
	CHECK(WydDialectDroppedOpcode(0, 1) == 0x333 && WydDialectDroppedTimes(0, 1) == 2);
	CHECK(WydDialectInboundFrames() == 6);
}

template <typename T, size_t N>
static const T& Translate(const unsigned char (&frame)[N])
{
	int size = 0;
	CHECK(In(frame, &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == static_cast<int>(sizeof(T)));
	return *reinterpret_cast<const T*>(g_out);
}

template <size_t N>
static void Passes(const unsigned char (&frame)[N])
{
	int size = 0;
	CHECK(In(frame, &size) == WYD_DIALECT_PASS);
	CHECK(In(frame, &size, static_cast<int>(N) - 1) == WYD_DIALECT_DROP);
}

static void TestInWorld()
{
	WydDialectResetStats();
	{
		const auto& m = Translate<MSG_UpdateScore>(k_in_update_score);
		CHECK(m.Header.Type == 0x336 && m.Header.ID == 5 && m.Header.Size == 152);
		CHECK(m.Score.Level == 398 && m.Score.Ac == 120 && m.Score.Damage == 300);
		CHECK(m.Score.Reserved == 0 && m.Score.AttackRun == 0x34);
		CHECK(m.Score.MaxHp == 5000 && m.Score.MaxMp == 800 && m.Score.Hp == 4999 && m.Score.Mp == 799);
		CHECK(m.Score.Str == 200 && m.Score.Int == 50 && m.Score.Dex == 100 && m.Score.Con == 150);
		CHECK(m.Score.Special[0] == 1 && m.Score.Special[3] == 65532);
		CHECK(m.Critical == 9 && m.SaveMana == 10);
		CHECK(m.Affect[0] == 0x0102 && m.Affect[31] == 0xABCD && m.Affect[1] == 0);
		CHECK(m.Guild == 77 && m.GuildLevel == 513);
		CHECK(m.Resist[0] == -1 && m.Resist[1] == 2 && m.Resist[2] == 3 && m.Resist[3] == 127);
		CHECK(m.ReqHp == 4999 && m.ReqMp == 799);
		CHECK(m.Magic == 300 && m.Rsv == 0 && m.LearnedSkill == 0); // not the 0xCC quirk
	}
	CHECK(WydDialectStatValue(WYD_STAT_FIELD_ZEROED) == 0);
	{
		const auto& m = Translate<MSG_UpdateScore>(k_in_update_score_magic_overflow);
		CHECK(m.Magic == 0 && m.Score.Level == 398);
		CHECK(WydDialectStatValue(WYD_STAT_FIELD_ZEROED) == 1);
	}
	int size = 0;
	CHECK(In(k_in_update_score_level_overflow, &size) == WYD_DIALECT_DROP);
	CHECK(WydDialectStatValue(WYD_STAT_IN_DROP_RANGE) == 1);
	CHECK(In(k_in_update_score, &size, 148) == WYD_DIALECT_DROP);
	{
		const auto& m = Translate<MSG_UpdateAffect>(k_in_send_affect);
		CHECK(m.Header.Type == 0x3B9 && m.Header.Size == 268);
		CHECK(m.Affect[0].Type == 8 && m.Affect[0].Value == 0x1F && m.Affect[0].Level == 3 && m.Affect[0].Time == 1234);
		CHECK(m.Affect[1].Type == 0 && m.Affect[1].Value == 0 && m.Affect[1].Time == 0);
		CHECK(static_cast<unsigned char>(m.Affect[31].Type) == 255 && m.Affect[31].Value == 255);
		CHECK(m.Affect[31].Level == 0 && m.Affect[31].Time == 0x7FFFFFFF); // level 200 does not fit a char
		CHECK(WydDialectStatValue(WYD_STAT_FIELD_ZEROED) == 2);
	}
	{
		const auto& m = Translate<MSG_UpdateEquip>(k_in_update_equip);
		CHECK(m.Header.Type == 0x36B && m.Header.ID == 5);
		CHECK(m.sEquip[0] == 1 && m.sEquip[15] == 3500 && m.sEquip[1] == 0);
		CHECK(m.sEquip[16] == 0 && m.sEquip[17] == 0);
		CHECK(static_cast<unsigned char>(m.Equip2[0]) == 0x80 && m.Equip2[15] == 0x7F);
		CHECK(m.Equip2[16] == 0 && m.Equip2[17] == 0);
	}
	{
		const auto& m = Translate<MSG_CreateMobTrade>(k_in_create_mob_trade);
		CHECK(m.Header.Type == 0x363 && m.Header.Size == 260);
		CHECK(m.PosX == 2100 && m.PosY == 2101 && m.MobID == 5);
		CHECK(Name(m.MobName, "Guerreiro", 12) && m.Equip[15] == 3500 && m.Equip[16] == 0);
		CHECK(m.Affect[31] == 0xFFFF && m.Guild == 77 && m.GuildLevel == 1);
		CHECK(m.Score.Level == 398 && m.CreateType == 2);
		CHECK(static_cast<unsigned char>(m.Equip2[0]) == 0x80 && m.Equip2[15] == 0x7F);
		CHECK(Name(m.Nick, "LojaTab"));
		CHECK(std::memcmp(m.Desc, "Vendo pocoes baratas 123", 24) == 0 && m.Server == 0);
	}
	{
		const auto& m = Translate<MSG_SetHpDam>(k_in_set_hp_dam);
		CHECK(m.Header.ID == 1234 && m.Hp == 100 && m.Dam == -250);
		const auto& o = Translate<MSG_SetHpDam>(k_in_set_hp_dam_overflow);
		CHECK(o.Hp == 100 && o.Dam == 0);
		CHECK(WydDialectStatValue(WYD_STAT_FIELD_ZEROED) == 3);
	}
	// Pass-through frames are read by the runtime as its own structs.
	Passes(k_in_set_hp_mp);
	{
		const auto& m = *reinterpret_cast<const MSG_SetHpMp*>(k_in_set_hp_mp);
		CHECK(m.Hp == 4000 && m.Mp == 700 && m.ReqHp == 4999 && m.ReqMp == 799);
	}
	Passes(k_in_send_item);
	{
		const auto& m = *reinterpret_cast<const MSG_SendItem*>(k_in_send_item);
		CHECK(m.DestType == 1 && m.DestPos == 63);
		ItemIs(m.Item, 401, 7, 8, 0, 0, 255, 1);
	}
	Passes(k_in_update_etc);
	{
		const auto& m = *reinterpret_cast<const MSG_UpdateEtc*>(k_in_update_etc);
		CHECK(m.FakeExp == 77 && m.Exp == (1LL << 40) + 9);
		CHECK(m.LearnedSkill[0] == 0x40000001u && m.LearnedSkill[1] == 0x40000001u);
		CHECK(m.ScoreBonus == 5 && m.SpecialBonus == 6 && m.SkillBonus == 7 && m.Coin == 2000000001);
	}
	Passes(k_in_pk_info);
	Passes(k_in_update_weather);
	CHECK(reinterpret_cast<const MSG_STANDARDPARM*>(k_in_update_weather)->Parm == 2);
	{
		const auto& m = Translate<MSG_MessagePanel>(k_in_notice_bad_pass);
		CHECK(m.Header.Type == 0x101 && m.Header.ID == 0 && m.Header.Size == 140);
		CHECK(std::strcmp(m.String, "Senha incorreta.") == 0);
		const auto& u = Translate<MSG_MessagePanel>(k_in_notice_unknown);
		CHECK(std::strcmp(u.String, "Aviso do servidor (999).") == 0);
	}
	// Distinct dropped opcodes: 0x336 (level overflow + short frame) and the five
	// truncated pass-through frames.
	CHECK(WydDialectDroppedCount(0) == 6);
	CHECK(WydDialectDroppedOpcode(0, 0) == 0x336 && WydDialectDroppedTimes(0, 0) == 2);
	CHECK(WydDialectStatValue(WYD_STAT_IN_DROP_SIZE) == 6);
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

	// ReqTeleport / ChangeCity: StandardParm, header-only for the server.
	for (unsigned char op : {0x90, 0x91})
	{
		char parm[16] = {16, 0, 0, 0, static_cast<char>(op), 0x02};
		CHECK(WydDialectOutbound(parm, 16, wire, sizeof(wire), &size) == WYD_DIALECT_PASS);
		CHECK(WydDialectOutbound(parm, 12, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	}
	// Chat (0x333) has a 96- vs 128-byte text divergence: not sent until mapped.
	char chat[140] = {static_cast<char>(140), 0, 0, 0, 0x33, 0x03};
	CHECK(WydDialectOutbound(chat, sizeof(chat), wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	CHECK(WydDialectStatValue(WYD_STAT_OUT_DROP_UNKNOWN) == 1);
	CHECK(WydDialectDroppedOpcode(1, WydDialectDroppedCount(1) - 1) == 0x333);
}

static void TestAttack()
{
	WydDialectResetStats();
	{
		// One-target echo: the server answers 0x367 with N = 1.
		const auto& m = Translate<MSG_Attack>(k_in_attack_echo);
		CHECK(m.Header.Type == 0x367 && m.Header.ID == 30000 && m.Header.Size == 168);
		CHECK(m.FakeExp == 0);
		CHECK(m.ReqMp == 40); // server ReqMp@58, not its CurrentHp@16 (320)
		CHECK(m.CurrentExp == (1LL << 33) + 7 && m.Rsv == 0);
		CHECK(m.PosX == 2100 && m.PosY == 2101 && m.TargetX == 2102 && m.TargetY == 2103);
		CHECK(m.AttackerID == 5 && m.Progress == 3 && m.Motion == 4 && m.FlagLocal == 0);
		CHECK(m.DoubleCritical == 1 && m.SkillParm == 0 && m.CurrentMp == 45 && m.SkillIndex == -1);
		CHECK(m.Dam[0].TargetID == 1500 && m.Dam[0].Damage == 37);
		for (int i = 1; i < 13; ++i)
			CHECK(m.Dam[i].TargetID == 0 && m.Dam[i].Damage == 0);
	}
	{
		const auto& m = Translate<MSG_Attack>(k_in_attack_multi);
		CHECK(m.SkillIndex == 33 && m.Motion == 6 && m.ReqMp == 40);
		CHECK(m.Dam[0].TargetID == 1000 && m.Dam[0].Damage == 0);
		CHECK(m.Dam[4].TargetID == 1004 && m.Dam[4].Damage == -3); // miss code kept
		CHECK(m.Dam[12].TargetID == 1012 && m.Dam[12].Damage == 120);
	}
	{
		const auto& m = Translate<MSG_Attack>(k_in_attack_mob);
		CHECK(m.AttackerID == 1200 && m.ReqMp == 0 && m.SkillIndex == 0);
		CHECK(m.Dam[0].TargetID == 5 && m.Dam[0].Damage == 12);
	}
	CHECK(WydDialectStatValue(WYD_STAT_FIELD_ZEROED) == 0);
	{
		const auto& m = Translate<MSG_Attack>(k_in_attack_target_overflow);
		CHECK(m.Dam[0].TargetID == 0 && m.Dam[0].Damage == 37);
		CHECK(WydDialectStatValue(WYD_STAT_FIELD_ZEROED) == 1);
	}
	CHECK(WydDialectStatValue(WYD_STAT_IN_TRANSLATED) == 4);
	CHECK(WydDialectStatValue(WYD_STAT_IN_ATTACK) == 4);

	int size = 0;
	CHECK(In(k_in_attack_too_many, &size) == WYD_DIALECT_DROP); // N = 14
	CHECK(In(k_in_attack_echo, &size, 60) == WYD_DIALECT_DROP);  // N = 0
	CHECK(In(k_in_attack_echo, &size, 64) == WYD_DIALECT_DROP);  // half an entry
	CHECK(In(k_in_attack_echo, &size, 12) == WYD_DIALECT_DROP);
	{
		// The typed opcodes keep their own capacity.
		unsigned char two[sizeof(k_in_attack_multi)];
		std::memcpy(two, k_in_attack_multi, sizeof(two));
		two[4] = 0x9E;
		two[5] = 0x03;
		CHECK(In(two, &size, 76) == WYD_DIALECT_TRANSLATED && size == 80);
		CHECK(reinterpret_cast<const MSG_AttackTwo*>(g_out)->Dam[1].TargetID == 1001);
		CHECK(In(two, &size, 84) == WYD_DIALECT_DROP); // three targets in AttackTwo
		two[4] = 0x9D;
		CHECK(In(two, &size, 68) == WYD_DIALECT_TRANSLATED && size == 72);
		CHECK(In(two, &size, 76) == WYD_DIALECT_DROP);
	}
	CHECK(WydDialectStatValue(WYD_STAT_IN_DROP_SIZE) == 6);
	CHECK(WydDialectStatValue(WYD_STAT_IN_DROP_UNKNOWN) == 0);

	// Outbound: runtime structs over non-zero padding.
	char wire[WYD_DIALECT_MAX_FRAME];
	MSG_Attack a;
	std::memset(&a, 0xAB, sizeof(a));
	a.Header.Size = sizeof(MSG_AttackOne);
	a.Header.KeyWord = 0;
	a.Header.CheckSum = 0;
	a.Header.Type = 0x39D;
	a.Header.ID = 5;
	a.Header.Tick = 0x01020304;
	a.FakeExp = 0;
	a.ReqMp = 999; // runtime-only: must not reach the server
	a.CurrentExp = 0;
	a.Rsv = 0;
	a.PosX = 2100;
	a.PosY = 2101;
	a.TargetX = 2102;
	a.TargetY = 2103;
	a.AttackerID = 5;
	a.Progress = 0;
	a.Motion = 4;
	a.FlagLocal = 0;
	a.DoubleCritical = 0;
	a.SkillParm = 0;
	a.CurrentMp = 0;
	a.SkillIndex = -1;
	a.Dam[0].TargetID = 1500;
	a.Dam[0].Damage = -2;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&a), sizeof(MSG_AttackOne), wire, sizeof(wire), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == 68 && std::memcmp(wire, k_out_attack_one, 68) == 0);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&a), sizeof(MSG_Attack), wire, sizeof(wire), &size) == WYD_DIALECT_DROP);

	a.Header.Size = sizeof(MSG_Attack);
	a.Header.Type = 0x367;
	a.Motion = 6;
	a.SkillIndex = 33;
	for (int i = 0; i < 13; ++i)
	{
		a.Dam[i].TargetID = i < 2 ? static_cast<unsigned short>(1000 + i) : 0;
		a.Dam[i].Damage = i < 2 ? -1 : 0;
	}
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&a), sizeof(MSG_Attack), wire, sizeof(wire), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == 164 && std::memcmp(wire, k_out_attack_multi, 164) == 0);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&a), 164, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	CHECK(WydDialectStatValue(WYD_STAT_OUT_TRANSLATED) == 2);
	CHECK(WydDialectStatValue(WYD_STAT_OUT_ATTACK) == 2);
	CHECK(WydDialectStatValue(WYD_STAT_OUT_DROP_SIZE) == 2);

	// Restart (header only) and ReqMobByID (StandardParm) pass unchanged.
	char restart[12] = {12, 0, 0, 0, static_cast<char>(0x89), 0x02};
	CHECK(WydDialectOutbound(restart, 12, wire, sizeof(wire), &size) == WYD_DIALECT_PASS);
	CHECK(WydDialectOutbound(restart, 16, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	char reqMob[16] = {16, 0, 0, 0, 0x69, 0x03};
	CHECK(WydDialectOutbound(reqMob, 16, wire, sizeof(wire), &size) == WYD_DIALECT_PASS);
	CHECK(WydDialectOutbound(reqMob, 12, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	char delay[16] = {16, 0, 0, 0, static_cast<char>(0xAE), 0x03};
	CHECK(WydDialectOutbound(delay, 16, wire, sizeof(wire), &size) == WYD_DIALECT_PASS);
	CHECK(WydDialectOutbound(delay, 12, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
}

int main()
{
	TestAccountLogin();
	TestNewCharacter();
	TestCharacterLogin();
	TestCreateMob();
	TestInboundPassAndDrop();
	TestInWorld();
	TestOutbound();
	TestAttack();
	std::printf("%d checks, %d failures\n", g_checks, g_failures);
	return g_failures == 0 ? 0 : 1;
}
