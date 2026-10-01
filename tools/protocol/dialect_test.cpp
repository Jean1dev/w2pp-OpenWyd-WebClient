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
	// Unmapped opcodes (here CombineItem 0x3A6) are never passed through.
	unsigned char chat[154] = {154, 0, 0, 0, 0xA6, 0x03};
	CHECK(In(chat, &size) == WYD_DIALECT_DROP);
	CHECK(In(chat, &size) == WYD_DIALECT_DROP);
	CHECK(WydDialectStatValue(WYD_STAT_IN_PASS) == 3);
	CHECK(WydDialectStatValue(WYD_STAT_IN_DROP_UNKNOWN) == 2);
	CHECK(WydDialectDroppedCount(0) == 2);
	CHECK(WydDialectDroppedOpcode(0, 1) == 0x3A6 && WydDialectDroppedTimes(0, 1) == 2);
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
	// Unmapped opcodes (here CombineItem 0x3A6) are never sent.
	char chat[156] = {static_cast<char>(156), 0, 0, 0, static_cast<char>(0xA6), 0x03};
	CHECK(WydDialectOutbound(chat, sizeof(chat), wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	CHECK(WydDialectStatValue(WYD_STAT_OUT_DROP_UNKNOWN) == 1);
	CHECK(WydDialectDroppedOpcode(1, WydDialectDroppedCount(1) - 1) == 0x3A6);
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

	// Motion as protocol/motion.go EncodeMotion writes it (level up: 14/3?).
	{
		unsigned char mo[20] = {20, 0, 0, 0, 0x6A, 0x03};
		mo[12] = 14; mo[14] = 3; // Motion, Parm; NotUsed @16 zero
		char in[WYD_DIALECT_MAX_FRAME];
		int inSize = 0;
		CHECK(WydDialectInbound(reinterpret_cast<char*>(mo), 20, in, sizeof(in), &inSize) == WYD_DIALECT_PASS);
		MSG_Motion m;
		std::memcpy(&m, mo, sizeof(m));
		CHECK(m.Motion == 14 && m.Parm == 3 && m.Direction == 0.0f);
		CHECK(WydDialectInbound(reinterpret_cast<char*>(mo), 16, in, sizeof(in), &inSize) == WYD_DIALECT_DROP);
	}
	// ShopList built at the server's offsets passes and reads back in the runtime struct.
	{
		unsigned char shop[236] = {};
		shop[0] = 236 & 0xFF; shop[1] = 236 >> 8; shop[4] = 0x7C; shop[5] = 0x01;
		shop[12] = 3;                                   // ShopType 3 (skill master)
		shop[16] = 5024 & 0xFF; shop[17] = 5024 >> 8;   // List[0].sIndex
		shop[16 + 26 * 8] = 5047 & 0xFF; shop[17 + 26 * 8] = 5047 >> 8; // List[26]
		shop[232] = 7;                                  // Tax
		char in[WYD_DIALECT_MAX_FRAME];
		int inSize = 0;
		CHECK(WydDialectInbound(reinterpret_cast<char*>(shop), 236, in, sizeof(in), &inSize) == WYD_DIALECT_PASS);
		MSG_ShopList sl;
		std::memcpy(&sl, shop, sizeof(sl));
		CHECK(sl.ShopType == 3 && sl.List[0].sIndex == 5024 && sl.List[26].sIndex == 5047 && sl.Tax == 7);
		CHECK(WydDialectInbound(reinterpret_cast<char*>(shop), 232, in, sizeof(in), &inSize) == WYD_DIALECT_DROP);
	}

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
	// Melee (TMHuman.cpp) sends 0x039D with the full MSG_Attack: N = 13, the
	// opcode is kept and the prefix/Dam[0] match the one-target frame.
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&a), sizeof(MSG_Attack), wire, sizeof(wire), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == 164 && static_cast<unsigned char>(wire[0]) == 164 && wire[1] == 0);
	CHECK(static_cast<unsigned char>(wire[4]) == 0x9D && wire[5] == 0x03);
	CHECK(std::memcmp(wire + 2, k_out_attack_one + 2, 66) == 0);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&a), 100, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);

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
	CHECK(WydDialectStatValue(WYD_STAT_OUT_TRANSLATED) == 3);
	CHECK(WydDialectStatValue(WYD_STAT_OUT_ATTACK) == 3);
	CHECK(WydDialectStatValue(WYD_STAT_OUT_DROP_SIZE) == 2);

	// Restart (header only) and ReqMobByID (StandardParm) pass unchanged.
	char restart[12] = {12, 0, 0, 0, static_cast<char>(0x89), 0x02};
	CHECK(WydDialectOutbound(restart, 12, wire, sizeof(wire), &size) == WYD_DIALECT_PASS);
	CHECK(WydDialectOutbound(restart, 16, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	char reqMob[16] = {16, 0, 0, 0, 0x69, 0x03};
	CHECK(WydDialectOutbound(reqMob, 16, wire, sizeof(wire), &size) == WYD_DIALECT_PASS);
	CHECK(WydDialectOutbound(reqMob, 12, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	// NPC shop and skill learning pass unchanged at their exact runtime sizes.
	MSG_REQShopList reqShop{};
	reqShop.Header.Size = sizeof(reqShop);
	reqShop.Header.Type = 0x27B;
	reqShop.TargetID = 1234;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&reqShop), sizeof(reqShop), wire, sizeof(wire), &size) == WYD_DIALECT_PASS);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&reqShop), 14, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	MSG_ApplyBonus bonus{};
	bonus.Header.Size = sizeof(bonus);
	bonus.Header.Type = 0x277;
	bonus.BonusType = 2;
	bonus.Detail = 5024;
	bonus.TargetID = 1234;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&bonus), sizeof(bonus), wire, sizeof(wire), &size) == WYD_DIALECT_PASS);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&bonus), 18, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	// Offsets as the server encodes them (protocol/shop.go, messages.go),
	// read back through the runtime structs.
	{
		const unsigned char* rb = reinterpret_cast<const unsigned char*>(&bonus);
		CHECK(rb[12] == 2 && rb[13] == 0 && rb[14] == (5024 & 0xFF) && rb[15] == (5024 >> 8) &&
			rb[16] == (1234 & 0xFF) && rb[17] == (1234 >> 8));
		const unsigned char* rs = reinterpret_cast<const unsigned char*>(&reqShop);
		CHECK(rs[12] == (1234 & 0xFF) && rs[13] == (1234 >> 8));
	}
	// SetShortSkill (Skill[20]) passes unchanged at its exact size only.
	char shortSkill[32] = {32, 0, 0, 0, 0x78, 0x03};
	shortSkill[12] = 7;
	CHECK(WydDialectOutbound(shortSkill, 32, wire, sizeof(wire), &size) == WYD_DIALECT_PASS);
	CHECK(WydDialectOutbound(shortSkill, 28, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	char delay[16] = {16, 0, 0, 0, static_cast<char>(0xAE), 0x03};
	CHECK(WydDialectOutbound(delay, 16, wire, sizeof(wire), &size) == WYD_DIALECT_PASS);
	CHECK(WydDialectOutbound(delay, 12, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
}

static void TestCombatDiagnostics()
{
	int size = 0;
	WydCombatEnable(0);
	CHECK(In(k_in_attack_multi, &size) == WYD_DIALECT_TRANSLATED);
	CHECK(WydCombatCount(0) == 0);
	WydCombatEnable(1);
	CHECK(In(k_in_attack_multi, &size) == WYD_DIALECT_TRANSLATED);
	CHECK(WydCombatCount(0) == 1 && WydCombatLost(0) == 0);
	CHECK(WydCombatValue(0, 0, 1) == 5 && WydCombatValue(0, 0, 2) == 33);
	CHECK(WydCombatValue(0, 0, 3) == 3 && WydCombatValue(0, 0, 4) == 320);
	CHECK(WydCombatValue(0, 0, 5) == 45 && WydCombatValue(0, 0, 6) == 7 && WydCombatValue(0, 0, 7) == 2);
	CHECK(WydCombatValue(0, 0, 10) == 13 && WydCombatValue(0, 0, 11) == 1000);
	CHECK(WydCombatValue(0, 0, 20) == -3 && WydCombatValue(0, 0, 36) == 120);
	CHECK(In(k_in_attack_multi, &size, 61) == WYD_DIALECT_DROP);
	CHECK(WydDialectInbound(reinterpret_cast<const char*>(k_in_attack_multi), sizeof(k_in_attack_multi), g_out, 1, &size) == WYD_DIALECT_DROP);
	CHECK(WydCombatCount(0) == 1);
	CHECK(WydCombatValue(0, -1, 0) == 0 && WydCombatValue(0, 0, 37) == 0);
	for (int i = 0; i < 65; ++i) In(k_in_attack_multi, &size);
	CHECK(WydCombatCount(0) == 64 && WydCombatLost(0) == 2);
	CHECK(WydCombatValue(0, 0, 0) == 3 && WydCombatValue(0, 63, 0) == 66);
	MSG_Attack out{};
	out.Header.Type = 0x367; out.AttackerID = 5; out.SkillIndex = 0;
	out.Dam[0].TargetID = 1500; out.Dam[0].Damage = -1;
	char wire[8192];
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&out), sizeof(out), wire, sizeof(wire), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(WydCombatCount(1) == 1 && WydCombatValue(1, 0, 11) == 1500 && WydCombatValue(1, 0, 12) == -1);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&out), 61, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	CHECK(WydCombatCount(1) == 1);
	WydCombatClear();
	CHECK(WydCombatCount(0) == 0 && WydCombatCount(1) == 0 && WydCombatLost(0) == 0);
	In(k_in_attack_multi, &size);
	CHECK(WydCombatCount(0) == 1);
	WydCombatEnable(0);
	In(k_in_attack_multi, &size);
	CHECK(WydCombatCount(0) == 0 && WydCombatValue(0, 0, 1) == 0);
}

static void TestItems()
{
	WydDialectResetStats();
	int size = 0;
	{
		// Server echo of a swap: bytes 12..15 by position, WarpID -> TargetID.
		const auto& m = Translate<MSG_SwapItem>(k_in_swap_item);
		CHECK(m.Header.Type == 0x376 && m.Header.ID == 5 && m.Header.Size == 20);
		CHECK(m.SourType == 0 && m.SourPos == 6 && m.DestType == 1 && m.DestPos == 5 && m.TargetID == 0);
	}
	CHECK(In(k_in_swap_item, &size, 19) == WYD_DIALECT_DROP);
	CHECK(In(k_in_swap_item_range, &size) == WYD_DIALECT_DROP); // carry 60: no runtime page
	CHECK(WydDialectStatValue(WYD_STAT_IN_DROP_RANGE) == 1);
	{
		const auto& m = Translate<MSG_UseItem>(k_in_use_item);
		CHECK(m.Header.Type == 0x373 && m.Header.Size == 36);
		CHECK(m.SourType == 1 && m.SourPos == 3 && m.DestType == 0 && m.DestPos == 6);
		CHECK(m.GridX == 2100 && m.GridY == 2101 && m.ItemID == 0);
	}
	CHECK(In(k_in_use_item, &size, 36) == WYD_DIALECT_DROP); // runtime size is not the wire size
	Passes(k_in_update_carry);
	{
		const auto* m = reinterpret_cast<const MSG_Carry*>(k_in_update_carry);
		CHECK(m->Carry[0].sIndex == 401 && m->Carry[1].sIndex == 406 && m->Coin == 1000350);
	}

	char wire[64];
	MSG_SwapItem s;
	std::memset(&s, 0xAB, sizeof(s));
	s.Header.Size = sizeof(s);
	s.Header.KeyWord = 0;
	s.Header.CheckSum = 0;
	s.Header.Type = 0x376;
	s.Header.ID = 5;
	s.Header.Tick = 0x01020304;
	s.SourType = 0;
	s.SourPos = 6;
	s.DestType = 1;
	s.DestPos = 5;
	s.TargetID = 1234;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&s), sizeof(s), wire, sizeof(wire), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == 20 && std::memcmp(wire, k_out_swap_item, 20) == 0); // padding @18 zeroed
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&s), 19, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	s.DestType = 3;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&s), sizeof(s), wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	s.DestType = 0;
	s.DestPos = 16; // equip has 16 server slots
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&s), sizeof(s), wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	CHECK(WydDialectStatValue(WYD_STAT_OUT_DROP_RANGE) == 2);

	MSG_UseItem u;
	std::memset(&u, 0xAB, sizeof(u));
	u.Header = s.Header;
	u.Header.Size = sizeof(u);
	u.Header.Type = 0x373;
	u.SourType = 1;
	u.SourPos = 0;
	u.DestType = 0;
	u.DestPos = 0;
	u.GridX = 2100;
	u.GridY = 2101;
	u.ItemID = 777;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&u), sizeof(u), wire, sizeof(wire), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == 34 && std::memcmp(wire, k_out_use_item, 34) == 0); // Size rewritten, padding not sent
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&u), 34, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	CHECK(WydDialectStatValue(WYD_STAT_OUT_TRANSLATED) == 2);
	CHECK(WydDialectStatValue(WYD_STAT_OUT_DROP_SIZE) == 2);
}

static void TestShopCargoChat()
{
	WydDialectResetStats();
	int size = 0;
	{
		// Cargo gold: 57 on the wire, StandardParm(coin) in the runtime.
		const auto& m = Translate<MSG_STANDARDPARM>(k_in_update_cargo_coin);
		CHECK(m.Header.Type == 0x339 && m.Header.ID == 5 && m.Header.Size == 16 && m.Parm == 1234567);
	}
	CHECK(In(k_in_update_cargo_coin, &size, 56) == WYD_DIALECT_DROP);
	{
		// Server notice: bare NUL-terminated text -> fixed 140-byte line.
		const auto& m = Translate<MSG_MessageChat>(k_in_chat_notice);
		CHECK(m.Header.Type == 0x333 && m.Header.ID == 5 && m.Header.Size == 140);
		CHECK(std::strcmp(m.String, "Pontos Caos atual: 3 (+1)") == 0 && m.String[127] == 0);
	}
	{
		const auto& m = Translate<MSG_MessageChat>(k_in_chat_player);
		CHECK(m.Header.ID == 7 && std::strcmp(m.String, "ola B") == 0);
	}
	{
		// A 140-byte line without terminator is cut at String[127].
		unsigned char full[140];
		std::memcpy(full, k_in_chat_player, sizeof(full));
		std::memset(full + 12, 'x', 128);
		CHECK(In(full, &size) == WYD_DIALECT_TRANSLATED);
		const auto& m = *reinterpret_cast<const MSG_MessageChat*>(g_out);
		CHECK(m.String[126] == 'x' && m.String[127] == 0);
	}
	CHECK(In(k_in_chat_player, &size, 11) == WYD_DIALECT_DROP);
	{
		unsigned char big[141] = {141, 0, 0, 0, 0x33, 0x03};
		CHECK(In(big, &size) == WYD_DIALECT_DROP);
	}
	{
		const auto& m = Translate<MSG_MessageWhisper>(k_in_whisper);
		CHECK(m.Header.Type == 0x334 && m.Header.ID == 7 && m.Header.Size == 160);
		CHECK(Name(m.MobName, "Destino") && std::strcmp(m.String, "oi") == 0 && m.Color == 0);
	}
	{
		const auto& m = Translate<MSG_MessageWhisper>(k_in_whisper_short);
		CHECK(Name(m.MobName, "Destino") && std::strcmp(m.String, "oi") == 0 && m.Color == 0);
	}
	CHECK(In(k_in_whisper, &size, 27) == WYD_DIALECT_DROP);
	{
		unsigned char big[159] = {159, 0, 0, 0, 0x34, 0x03};
		CHECK(In(big, &size) == WYD_DIALECT_DROP);
	}
	Passes(k_in_buy_echo);
	CHECK(reinterpret_cast<const MSG_Buy*>(k_in_buy_echo)->Coin == 2400);
	Passes(k_in_sell_echo);
	Passes(k_in_deposit_echo);
	CHECK(WydDialectStatValue(WYD_STAT_IN_DROP_UNKNOWN) == 0);

	char wire[256];
	MSG_Buy b;
	std::memset(&b, 0xAB, sizeof(b));
	b.Header.Size = sizeof(b);
	b.Header.KeyWord = 0;
	b.Header.CheckSum = 0;
	b.Header.Type = 0x379;
	b.Header.ID = 5;
	b.Header.Tick = 0x01020304;
	b.TargetID = 12474;
	b.TargetCarryPos = 3;
	b.MyCarryPos = 17;
	b.Coin = 0;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&b), sizeof(b), wire, sizeof(wire), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == 24 && std::memcmp(wire, k_out_buy, 24) == 0); // padding @18 zeroed
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&b), 23, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);

	MSG_Sell sl;
	std::memset(&sl, 0xAB, sizeof(sl));
	sl.Header = b.Header;
	sl.Header.Size = sizeof(sl);
	sl.Header.Type = 0x37A;
	sl.TargetID = 12474;
	sl.MyType = 1;
	sl.MyPos = 13;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&sl), sizeof(sl), wire, sizeof(wire), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == 18 && std::memcmp(wire + 4, k_in_sell_echo + 4, 2) == 0 && std::memcmp(wire + 12, k_in_sell_echo + 12, 6) == 0);
	CHECK(static_cast<unsigned char>(wire[0]) == 18 && wire[1] == 0);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&sl), 18, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	for (unsigned short op : {0x387, 0x388})
	{
		MSG_STANDARDPARM p{};
		p.Header.Size = sizeof(p);
		p.Header.Type = op;
		p.Parm = 500;
		CHECK(WydDialectOutbound(reinterpret_cast<char*>(&p), 16, wire, sizeof(wire), &size) == WYD_DIALECT_PASS);
		CHECK(WydDialectOutbound(reinterpret_cast<char*>(&p), 12, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	}
	MSG_MessageChat c{};
	c.Header.Size = sizeof(c);
	c.Header.Type = 0x333;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&c), sizeof(c), wire, sizeof(wire), &size) == WYD_DIALECT_PASS);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&c), 139, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	MSG_MessageWhisper w;
	std::memset(&w, 0xAB, sizeof(w));
	w.Header = b.Header;
	w.Header.Size = sizeof(w);
	w.Header.Type = 0x334;
	std::memset(w.MobName, 0, sizeof(w.MobName));
	std::memcpy(w.MobName, "Destino", 7);
	std::memset(w.String, 0, sizeof(w.String));
	std::memcpy(w.String, "oi", 2);
	w.Color = 0;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&w), sizeof(w), wire, sizeof(wire), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == 158 && static_cast<unsigned char>(wire[0]) == 158 && std::memcmp(wire + 12, k_in_whisper + 12, 146) == 0);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&w), 158, wire, sizeof(wire), &size) == WYD_DIALECT_DROP);
	CHECK(WydDialectStatValue(WYD_STAT_OUT_DROP_UNKNOWN) == 0);
}

static void TestParty()
{
	int size = 0;
	CHECK(In(k_in_party_invite, &size) == WYD_DIALECT_TRANSLATED && size == 44);
	auto* req = reinterpret_cast<MSG_REQParty*>(g_out);
	CHECK(req->Leader.ID == 7 && req->Leader.Class == 0 && req->Leader.PartyIndex == 0);
	CHECK(req->Leader.Level == 8 && req->Leader.MaxHp == 130 && req->Leader.Hp == 80 && Name(req->Leader.Name, "PartyA"));
	CHECK(req->TargetID == 0);
	CHECK(In(k_in_party_leader, &size) == WYD_DIALECT_TRANSLATED && size == 40);
	auto* add = reinterpret_cast<MSG_AddParty*>(g_out);
	CHECK(add->Party.ID == 7 && add->Party.PartyIndex == 0 && add->Party.Class == -1);
	CHECK(In(k_in_party_member, &size) == WYD_DIALECT_TRANSLATED);
	CHECK(add->Party.ID == 8 && add->Party.PartyIndex == 1 && Name(add->Party.Name, "PartyB"));
	CHECK(add->Party.Level == 8 && add->Party.Hp == 80 && add->Party.MaxHp == 130);
	CHECK(In(k_in_party_remove, &size) == WYD_DIALECT_TRANSLATED && size == 16);
	CHECK(reinterpret_cast<MSG_STANDARDPARM*>(g_out)->Parm == 8);
	for (int n = 12; n < 48; ++n) CHECK(In(k_in_party_invite, &size, n) == WYD_DIALECT_DROP);
	char bad[49] = {};
	std::memcpy(bad, k_in_party_member, 40);
	bad[20] = 0; bad[21] = 0;
	CHECK(WydDialectInbound(bad, 40, g_out, sizeof(g_out), &size) == WYD_DIALECT_DROP);
	std::memcpy(bad, k_in_party_member, 40); bad[15] = static_cast<char>(128);
	CHECK(WydDialectInbound(bad, 40, g_out, sizeof(g_out), &size) == WYD_DIALECT_DROP);
	CHECK(WydDialectInbound(reinterpret_cast<const char*>(k_in_party_member), 40, g_out, 39, &size) == WYD_DIALECT_DROP);
	std::memcpy(bad, k_in_party_remove, 16); bad[14] = bad[15] = static_cast<char>(0xAB);
	CHECK(WydDialectInbound(bad, 16, g_out, sizeof(g_out), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(reinterpret_cast<MSG_STANDARDPARM*>(g_out)->Parm == 8);
	MSG_REQParty r{};
	std::memcpy(&r.Header, k_out_party_request, 12);
	r.Header.Size = sizeof(r); r.Leader.Class = 0; r.Leader.ID = 7;
	r.Leader.Level = 8; r.Leader.MaxHp = 130; r.Leader.Hp = 80;
	std::memcpy(r.Leader.Name, "PartyA", 6); r.TargetID = 8;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&r), sizeof(r), g_out, sizeof(g_out), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == 48 && std::memcmp(g_out, k_out_party_request, 48) == 0);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&r), sizeof(r) - 1, g_out, sizeof(g_out), &size) == WYD_DIALECT_DROP);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&r), sizeof(r), g_out, 47, &size) == WYD_DIALECT_DROP);
	r.Leader.ID = 8;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&r), sizeof(r), g_out, sizeof(g_out), &size) == WYD_DIALECT_DROP);
	r.Leader.ID = 7;
	r.Leader.Class = -1; // male body: 7662 sends 0xFF, the server ignores it
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&r), sizeof(r), g_out, sizeof(g_out), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == 48 && static_cast<unsigned char>(g_out[12]) == 0xFF && std::memcmp(g_out + 13, k_out_party_request + 13, 35) == 0);
	r.Leader.Class = 4;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&r), sizeof(r), g_out, sizeof(g_out), &size) == WYD_DIALECT_DROP);
	r.Leader.Class = 0;
	r.TargetID = 1000;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&r), sizeof(r), g_out, sizeof(g_out), &size) == WYD_DIALECT_DROP);
	MSG_CNFParty2 a;
	std::memset(&a, 0xAB, sizeof(a));
	std::memcpy(&a, k_out_party_accept, 30);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&a), sizeof(a), g_out, sizeof(g_out), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == 32 && std::memcmp(g_out, k_out_party_accept, 32) == 0);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&a), 30, g_out, sizeof(g_out), &size) == WYD_DIALECT_DROP);
	MSG_STANDARDPARM leave{}; leave.Header.Type = 0x37E; leave.Header.Size = sizeof(leave); leave.Parm = 8;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&leave), sizeof(leave), g_out, sizeof(g_out), &size) == WYD_DIALECT_PASS);
	leave.Parm = -1;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&leave), sizeof(leave), g_out, sizeof(g_out), &size) == WYD_DIALECT_DROP);
	a.LeaderID = -1;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&a), sizeof(a), g_out, sizeof(g_out), &size) == WYD_DIALECT_DROP);
}

static void TestTrade()
{
	int size = 0;
	// Inbound: server 154 -> runtime 156, field by field.
	CHECK(In(k_in_trade_offer, &size) == WYD_DIALECT_TRANSLATED && size == 156);
	auto* t = reinterpret_cast<MSG_Trade*>(g_out);
	CHECK(t->Header.Size == 156 && t->Header.Type == 0x383 && t->Header.ID == 8);
	CHECK(t->Item[0].sIndex == 1100 && std::memcmp(&t->Item[0], k_in_trade_offer + 12, 8) == 0);
	CHECK(t->CarryPos[0] == 3 && t->CarryPos[1] == -1 && t->CarryPos[14] == -1);
	CHECK(t->TradeMoney == 50 && t->MyCheck == 1 && t->OpponentID == 7);
	for (int i = 1; i < 15; ++i) CHECK(t->Item[i].sIndex == 0);
	for (int n = 12; n < 154; ++n) CHECK(In(k_in_trade_offer, &size, n) == WYD_DIALECT_DROP);
	CHECK(WydDialectInbound(reinterpret_cast<const char*>(k_in_trade_offer), 154, g_out, 155, &size) == WYD_DIALECT_DROP);
	// The pre-fix server's placeholder results never reach the runtime.
	CHECK(In(k_in_trade_result_placeholder, &size) == WYD_DIALECT_DROP);
	CHECK(In(k_in_trade_ack_placeholder, &size) == WYD_DIALECT_DROP);
	// Range: opponent, check flag, money, slot and slot/item coherence.
	unsigned char bad[154];
	auto badIn = [&](int off, int value, int width) {
		std::memcpy(bad, k_in_trade_offer, sizeof(bad));
		for (int k = 0; k < width; ++k) bad[off + k] = static_cast<unsigned char>(value >> (8 * k));
		return WydDialectInbound(reinterpret_cast<const char*>(bad), 154, g_out, sizeof(g_out), &size);
	};
	CHECK(badIn(152, 0, 2) == WYD_DIALECT_DROP);
	CHECK(badIn(152, 1000, 2) == WYD_DIALECT_DROP);
	CHECK(badIn(151, 2, 1) == WYD_DIALECT_DROP);
	CHECK(badIn(147, -1, 4) == WYD_DIALECT_DROP);
	CHECK(badIn(147, 2000000001, 4) == WYD_DIALECT_DROP);
	CHECK(badIn(132, 64, 1) == WYD_DIALECT_DROP);
	CHECK(badIn(132, 0xFF, 1) == WYD_DIALECT_DROP); // item without a slot
	CHECK(badIn(12, 0x8000, 2) == WYD_DIALECT_DROP); // negative item index
	CHECK(badIn(147, 2000000000, 4) == WYD_DIALECT_TRANSLATED);
	// Signals pass with the exact header size.
	CHECK(In(k_in_quit_trade, &size) == WYD_DIALECT_PASS);
	CHECK(In(k_in_cnf_check, &size) == WYD_DIALECT_PASS);
	CHECK(In(k_in_trade_offer, &size, 12) == WYD_DIALECT_DROP);
	// Outbound: runtime 156 -> server 154, padding never leaks.
	MSG_Trade o;
	std::memset(&o, 0xCD, sizeof(o));
	std::memcpy(&o.Header, k_out_trade_offer, 12);
	o.Header.Size = sizeof(o);
	std::memcpy(o.Item, k_out_trade_offer + 12, sizeof(o.Item));
	std::memcpy(o.CarryPos, k_out_trade_offer + 132, sizeof(o.CarryPos));
	o.TradeMoney = 50; o.MyCheck = 1; o.OpponentID = 8;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&o), sizeof(o), g_out, sizeof(g_out), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == 154 && std::memcmp(g_out, k_out_trade_offer, 154) == 0);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&o), 154, g_out, sizeof(g_out), &size) == WYD_DIALECT_DROP);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&o), sizeof(o), g_out, 153, &size) == WYD_DIALECT_DROP);
	o.OpponentID = 0;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&o), sizeof(o), g_out, sizeof(g_out), &size) == WYD_DIALECT_DROP);
	o.OpponentID = 8; o.TradeMoney = -5;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&o), sizeof(o), g_out, sizeof(g_out), &size) == WYD_DIALECT_DROP);
	o.TradeMoney = 50; o.CarryPos[2] = 70;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&o), sizeof(o), g_out, sizeof(g_out), &size) == WYD_DIALECT_DROP);
	// The runtime's accept echoes the requester's empty offer: all slots -1.
	MSG_Trade accept{};
	accept.Header.Size = sizeof(accept); accept.Header.Type = 0x383; accept.Header.ID = 8;
	for (int i = 0; i < 15; ++i) accept.CarryPos[i] = -1;
	accept.OpponentID = 7;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&accept), sizeof(accept), g_out, sizeof(g_out), &size) == WYD_DIALECT_TRANSLATED);
	CHECK(size == 154 && static_cast<unsigned char>(g_out[132]) == 0xFF && (static_cast<unsigned char>(g_out[152]) | static_cast<unsigned char>(g_out[153]) << 8) == 7);
	MSG_STANDARD quit{}; quit.Size = sizeof(quit); quit.Type = 0x384; quit.ID = 7;
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&quit), sizeof(quit), g_out, sizeof(g_out), &size) == WYD_DIALECT_PASS);
	CHECK(std::memcmp(&quit, k_out_quit_trade, 8) == 0);
	CHECK(WydDialectOutbound(reinterpret_cast<char*>(&quit), 16, g_out, sizeof(g_out), &size) == WYD_DIALECT_DROP);
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
	TestCombatDiagnostics();
	TestItems();
	TestShopCargoChat();
	TestParty();
	TestTrade();
	std::printf("%d checks, %d failures\n", g_checks, g_failures);
	return g_failures == 0 ? 0 : 1;
}
