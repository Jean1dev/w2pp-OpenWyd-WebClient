// Injected into tmserver/internal/protocol with `go test -overlay` (see
// tools/protocol/run_go_vectors.py). Rebuilds the logical data of
// docs/evidence/03-protocolo/fixtures/dialect.json with the server's real
// encoders and requires byte equality with the independently built frames;
// outbound frames are parsed with the server's real decoders.
package protocol

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

type fxItem struct {
	Index uint16     `json:"index"`
	Eff   [][2]uint8 `json:"eff"`
}

func (it fxItem) sel() SelItem {
	s := SelItem{Index: it.Index}
	for k, e := range it.Eff {
		s.Eff[k] = e
	}
	return s
}

type fxSelChar struct {
	Slot      int               `json:"slot"`
	Name      string            `json:"name"`
	SPX       int               `json:"spx"` // JSON carries the u16 wire value
	SPY       int               `json:"spy"`
	Level     int32             `json:"level"`
	MaxHp     int32             `json:"maxHp"`
	Hp        int32             `json:"hp"`
	MaxMp     int32             `json:"maxMp"`
	Mp        int32             `json:"mp"`
	Str       int16             `json:"str"`
	Int       int16             `json:"int"`
	Dex       int16             `json:"dex"`
	Con       int16             `json:"con"`
	Direction uint8             `json:"direction"`
	Guild     uint16            `json:"guild"`
	Coin      int32             `json:"coin"`
	Exp       int64             `json:"exp"`
	Equip     map[string]fxItem `json:"equip"`
}

func (c fxSelChar) sel() SelChar {
	s := SelChar{
		Slot: c.Slot, Name: c.Name, SPX: int16(uint16(c.SPX)), SPY: int16(uint16(c.SPY)),
		Level: c.Level, MaxHp: c.MaxHp, Hp: c.Hp, MaxMp: c.MaxMp, Mp: c.Mp,
		Str: c.Str, Int: c.Int, Dex: c.Dex, Con: c.Con, Direction: c.Direction,
		Guild: c.Guild, Coin: c.Coin, Exp: c.Exp,
	}
	for k, it := range c.Equip {
		s.Equip[atoi(k)] = it.sel()
	}
	return s
}

type fxMob struct {
	Name         string            `json:"name"`
	PKPoint      uint8             `json:"pkPoint"`
	Clan         uint8             `json:"clan"`
	Merchant     uint8             `json:"merchant"`
	Guild        uint16            `json:"guild"`
	Class        uint8             `json:"class"`
	Quest        uint8             `json:"quest"`
	Coin         int32             `json:"coin"`
	Exp          int64             `json:"exp"`
	SPX          int16             `json:"spx"`
	SPY          int16             `json:"spy"`
	Level        int32             `json:"level"`
	Ac           int32             `json:"ac"`
	Damage       int32             `json:"damage"`
	MaxHp        int32             `json:"maxHp"`
	MaxMp        int32             `json:"maxMp"`
	Hp           int32             `json:"hp"`
	Mp           int32             `json:"mp"`
	Str          int16             `json:"str"`
	Int          int16             `json:"int"`
	Dex          int16             `json:"dex"`
	Con          int16             `json:"con"`
	Special      [4]int16          `json:"special"`
	AttackRun    uint8             `json:"attackRun"`
	Direction    uint8             `json:"direction"`
	Equip        map[string]fxItem `json:"equip"`
	Carry        map[string]fxItem `json:"carry"`
	LearnedSkill int32             `json:"learnedSkill"`
	Magic        uint32            `json:"magic"`
	ScoreBonus   uint16            `json:"scoreBonus"`
	SpecialBonus uint16            `json:"specialBonus"`
	SkillBonus   uint16            `json:"skillBonus"`
	Critical     uint8             `json:"critical"`
	SkillBar     [4]uint8          `json:"skillBar"`
	GuildLevel   uint8             `json:"guildLevel"`
	RegenHP      uint16            `json:"regenHP"`
	RegenMP      uint16            `json:"regenMP"`
	Resist       [4]uint8          `json:"resist"`
}

func (m fxMob) snapshot() MobSnapshot {
	s := MobSnapshot{
		Name: m.Name, PKPoint: m.PKPoint, Clan: m.Clan, Merchant: m.Merchant, Guild: m.Guild,
		Class: m.Class, Quest: m.Quest, Coin: m.Coin, Exp: m.Exp, SPX: m.SPX, SPY: m.SPY,
		Level: m.Level, Ac: m.Ac, Damage: m.Damage, MaxHp: m.MaxHp, MaxMp: m.MaxMp, Hp: m.Hp, Mp: m.Mp,
		Str: m.Str, Int: m.Int, Dex: m.Dex, Con: m.Con, Special: m.Special, AttackRun: m.AttackRun,
		Direction: m.Direction, LearnedSkill: m.LearnedSkill, Magic: m.Magic, ScoreBonus: m.ScoreBonus,
		SpecialBonus: m.SpecialBonus, SkillBonus: m.SkillBonus, Critical: m.Critical, SkillBar: m.SkillBar,
		GuildLevel: m.GuildLevel, RegenHP: m.RegenHP, RegenMP: m.RegenMP, Resist: m.Resist,
	}
	for k, it := range m.Equip {
		s.Equip[atoi(k)] = it.sel()
	}
	for k, it := range m.Carry {
		s.Carry[atoi(k)] = it.sel()
	}
	return s
}

type fxCreateMob struct {
	MobID           int               `json:"mobID"`
	Name            string            `json:"name"`
	IsPlayer        bool              `json:"isPlayer"`
	PKPoint         uint8             `json:"pkPoint"`
	CurKill         uint8             `json:"curKill"`
	TotKill         uint16            `json:"totKill"`
	PosX            int16             `json:"posX"`
	PosY            int16             `json:"posY"`
	Guild           uint16            `json:"guild"`
	GuildMemberType uint8             `json:"guildMemberType"`
	Level           int32             `json:"level"`
	Ac              int32             `json:"ac"`
	Damage          int32             `json:"damage"`
	MaxHp           int32             `json:"maxHp"`
	MaxMp           int32             `json:"maxMp"`
	Hp              int32             `json:"hp"`
	Mp              int32             `json:"mp"`
	Str             int16             `json:"str"`
	Int             int16             `json:"int"`
	Dex             int16             `json:"dex"`
	Con             int16             `json:"con"`
	Merchant        uint8             `json:"merchant"`
	AttackRun       uint8             `json:"attackRun"`
	Direction       uint8             `json:"direction"`
	CreateType      uint16            `json:"createType"`
	Equip           map[string]uint16 `json:"equip"`
	Affect          map[string]uint16 `json:"affect"`
	Anct            map[string]uint8  `json:"anct"`
}

func (d fxCreateMob) data() CreateMobData {
	c := CreateMobData{
		MobID: d.MobID, Name: d.Name, IsPlayer: d.IsPlayer, PKPoint: d.PKPoint, CurKill: d.CurKill,
		TotKill: d.TotKill, PosX: d.PosX, PosY: d.PosY, Guild: d.Guild, GuildMemberType: d.GuildMemberType,
		Level: d.Level, Ac: d.Ac, Damage: d.Damage, MaxHp: d.MaxHp, MaxMp: d.MaxMp, Hp: d.Hp, Mp: d.Mp,
		Str: d.Str, Int: d.Int, Dex: d.Dex, Con: d.Con, Merchant: d.Merchant, AttackRun: d.AttackRun,
		Direction: d.Direction, CreateType: d.CreateType,
	}
	for k, v := range d.Equip {
		c.Equip[atoi(k)] = v
	}
	for k, v := range d.Affect {
		c.Affect[atoi(k)] = v
	}
	for k, v := range d.Anct {
		c.AnctCode[atoi(k)] = v
	}
	return c
}

func atoi(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		panic(err)
	}
	return n
}

type fxFrame struct {
	WireHex string          `json:"wire_hex"`
	Logical json.RawMessage `json:"logical"`
}

type fxDoc struct {
	ClientVersion int32              `json:"clientVersion"`
	Inbound       map[string]fxFrame `json:"inbound"`
	Outbound      map[string]fxFrame `json:"outbound"`
}

func loadDialect(t *testing.T) fxDoc {
	t.Helper()
	p := os.Getenv("W2PP_EXT_DIALECT")
	if p == "" {
		t.Skip("W2PP_EXT_DIALECT not set")
	}
	raw, err := os.ReadFile(filepath.Clean(p))
	if err != nil {
		t.Fatal(err)
	}
	var d fxDoc
	if err := json.Unmarshal(raw, &d); err != nil {
		t.Fatal(err)
	}
	return d
}

func mustJSON(t *testing.T, raw json.RawMessage, v any) {
	t.Helper()
	if err := json.Unmarshal(raw, v); err != nil {
		t.Fatal(err)
	}
}

// TestExtDialectInbound: server encoders == independently built frames.
func TestExtDialectInbound(t *testing.T) {
	d := loadDialect(t)
	body := func(t *testing.T, name string) []byte {
		f, ok := d.Inbound[name]
		if !ok {
			t.Fatalf("fixture %s missing", name)
		}
		b, err := hex.DecodeString(f.WireHex)
		if err != nil {
			t.Fatal(err)
		}
		return b[HeaderSize:]
	}
	same := func(t *testing.T, got, want []byte) {
		t.Helper()
		if len(got) != len(want) {
			t.Fatalf("len %d, want %d", len(got), len(want))
		}
		for i := range got {
			if got[i] != want[i] {
				t.Fatalf("first difference at body offset %d (abs %d): go=%#02x fixture=%#02x", i, i+HeaderSize, got[i], want[i])
			}
		}
	}

	for _, name := range []string{"cnf_account_login", "cnf_account_login_level_overflow"} {
		t.Run(name, func(t *testing.T) {
			var l struct {
				Chars   []fxSelChar       `json:"chars"`
				Cargo   map[string]fxItem `json:"cargo"`
				Coin    int32             `json:"coin"`
				Account string            `json:"account"`
			}
			mustJSON(t, d.Inbound[name].Logical, &l)
			var chars []SelChar
			for _, c := range l.Chars {
				chars = append(chars, c.sel())
			}
			var cargo [128]SelItem
			for k, it := range l.Cargo {
				cargo[atoi(k)] = it.sel()
			}
			same(t, EncodeCNFAccountLoginBody(l.Account, chars, l.Coin, cargo), body(t, name))
		})
	}
	t.Run("cnf_new_character", func(t *testing.T) {
		var l struct {
			Chars []fxSelChar `json:"chars"`
		}
		mustJSON(t, d.Inbound["cnf_new_character"].Logical, &l)
		var chars []SelChar
		for _, c := range l.Chars {
			chars = append(chars, c.sel())
		}
		same(t, EncodeCNFNewCharacterBody(chars), body(t, "cnf_new_character"))
	})
	t.Run("cnf_character_login", func(t *testing.T) {
		var l struct {
			Slot       int       `json:"slot"`
			ClientID   int       `json:"clientID"`
			Weather    uint16    `json:"weather"`
			LoginX     int16     `json:"loginX"`
			LoginY     int16     `json:"loginY"`
			ShortSkill [16]uint8 `json:"shortSkill"`
			Mob        fxMob     `json:"mob"`
		}
		mustJSON(t, d.Inbound["cnf_character_login"].Logical, &l)
		got := EncodeCNFCharacterLoginBody(l.Slot, l.ClientID, l.Weather, l.LoginX, l.LoginY, l.Mob.snapshot(), l.ShortSkill)
		same(t, got, body(t, "cnf_character_login"))
	})
	for _, name := range []string{"create_mob_player", "create_mob_npc"} {
		t.Run(name, func(t *testing.T) {
			var l fxCreateMob
			mustJSON(t, d.Inbound[name].Logical, &l)
			same(t, EncodeCreateMobBody(l.data()), body(t, name))
		})
	}

	// In-world frames (etapa 4).
	for _, name := range []string{"update_score", "update_score_magic_overflow", "update_score_level_overflow"} {
		t.Run(name, func(t *testing.T) {
			var l struct {
				Level      int32             `json:"level"`
				Ac         int32             `json:"ac"`
				Damage     int32             `json:"damage"`
				AttackRun  uint8             `json:"attackRun"`
				MaxHp      int32             `json:"maxHp"`
				MaxMp      int32             `json:"maxMp"`
				Hp         int32             `json:"hp"`
				Mp         int32             `json:"mp"`
				Str        int16             `json:"str"`
				Int        int16             `json:"int"`
				Dex        int16             `json:"dex"`
				Con        int16             `json:"con"`
				Special    [4]int16          `json:"special"`
				Critical   uint8             `json:"critical"`
				SaveMana   uint8             `json:"saveMana"`
				Affect     map[string]uint16 `json:"affect"`
				Guild      uint16            `json:"guild"`
				GuildLevel uint16            `json:"guildLevel"`
				Resist     [4]int8           `json:"resist"`
				Magic      int32             `json:"magic"`
			}
			mustJSON(t, d.Inbound[name].Logical, &l)
			s := ScoreData{Level: l.Level, Ac: l.Ac, Damage: l.Damage, AttackRun: l.AttackRun, MaxHp: l.MaxHp,
				MaxMp: l.MaxMp, Hp: l.Hp, Mp: l.Mp, Str: l.Str, Int: l.Int, Dex: l.Dex, Con: l.Con,
				Special: l.Special, Critical: l.Critical, SaveMana: l.SaveMana, Guild: l.Guild,
				GuildLevel: l.GuildLevel, Resist: l.Resist, Magic: l.Magic}
			for k, v := range l.Affect {
				s.Affect[atoi(k)] = v
			}
			same(t, EncodeUpdateScore(s), body(t, name))
		})
	}
	t.Run("send_affect", func(t *testing.T) {
		var l struct {
			Affects map[string]struct {
				Type  uint8  `json:"type"`
				Value uint8  `json:"value"`
				Level uint16 `json:"level"`
				Time  uint32 `json:"time"`
			} `json:"affects"`
		}
		mustJSON(t, d.Inbound["send_affect"].Logical, &l)
		var a [MaxAffect]AffectData
		for k, v := range l.Affects {
			a[atoi(k)] = AffectData{Type: v.Type, Value: v.Value, Level: v.Level, Time: v.Time}
		}
		same(t, EncodeSendAffect(a), body(t, "send_affect"))
	})
	t.Run("update_equip", func(t *testing.T) {
		var l struct {
			Equip map[string]uint16 `json:"equip"`
			Anct  map[string]uint8  `json:"anct"`
		}
		mustJSON(t, d.Inbound["update_equip"].Logical, &l)
		var visual [16]uint16
		var anct [16]uint8
		for k, v := range l.Equip {
			visual[atoi(k)] = v
		}
		for k, v := range l.Anct {
			anct[atoi(k)] = v
		}
		same(t, EncodeUpdateEquip(visual, anct), body(t, "update_equip"))
	})
	t.Run("create_mob_trade", func(t *testing.T) {
		var l struct {
			Mob  fxCreateMob `json:"mob"`
			Tab  string      `json:"tab"`
			Desc string      `json:"desc"`
		}
		mustJSON(t, d.Inbound["create_mob_trade"].Logical, &l)
		tab := make([]byte, 26)
		copy(tab, l.Tab)
		same(t, EncodeCreateMobTradeBody(l.Mob.data(), tab, l.Desc), body(t, "create_mob_trade"))
	})
	for _, name := range []string{"set_hp_dam", "set_hp_dam_overflow"} {
		t.Run(name, func(t *testing.T) {
			var l struct {
				Hp  int32 `json:"hp"`
				Dam int32 `json:"dam"`
			}
			mustJSON(t, d.Inbound[name].Logical, &l)
			same(t, EncodeSetHpDam(l.Hp, l.Dam), body(t, name))
		})
	}
	t.Run("set_hp_mp", func(t *testing.T) {
		var l struct {
			Hp    int32 `json:"hp"`
			Mp    int32 `json:"mp"`
			ReqHp int32 `json:"reqHp"`
			ReqMp int32 `json:"reqMp"`
		}
		mustJSON(t, d.Inbound["set_hp_mp"].Logical, &l)
		same(t, EncodeSetHpMp(l.Hp, l.Mp, l.ReqHp, l.ReqMp), body(t, "set_hp_mp"))
	})
	t.Run("send_item", func(t *testing.T) {
		var l struct {
			InvType int    `json:"invType"`
			Slot    int    `json:"slot"`
			Item    fxItem `json:"item"`
		}
		mustJSON(t, d.Inbound["send_item"].Logical, &l)
		same(t, EncodeSendItemBody(l.InvType, l.Slot, l.Item.sel()), body(t, "send_item"))
	})
	t.Run("update_etc", func(t *testing.T) {
		var l struct {
			Hold         uint32 `json:"hold"`
			Exp          int64  `json:"exp"`
			Learn        int64  `json:"learn"`
			ScoreBonus   uint16 `json:"scoreBonus"`
			SpecialBonus uint16 `json:"specialBonus"`
			SkillBonus   uint16 `json:"skillBonus"`
			Magic        uint16 `json:"magic"`
			Coin         int32  `json:"coin"`
		}
		mustJSON(t, d.Inbound["update_etc"].Logical, &l)
		same(t, EncodeUpdateEtc(UpdateEtcData(l)), body(t, "update_etc"))
	})
	t.Run("pk_info", func(t *testing.T) {
		same(t, EncodeStandardParm(75), body(t, "pk_info"))
	})
	t.Run("update_weather", func(t *testing.T) {
		same(t, EncodeUpdateWeather(2), body(t, "update_weather"))
	})
	// handler.notify writes the notice code as a little-endian uint32 body.
	t.Run("notice_bad_pass", func(t *testing.T) {
		same(t, EncodeStandardParm(3), body(t, "notice_bad_pass"))
	})
	t.Run("notice_unknown", func(t *testing.T) {
		same(t, EncodeStandardParm(999), body(t, "notice_unknown"))
	})
}

// TestExtDialectOutbound: what the client translator must emit parses, with
// the server's decoders, into exactly the intended values.
func TestExtDialectOutbound(t *testing.T) {
	d := loadDialect(t)
	frame := func(name string) (Header, []byte) {
		b, err := hex.DecodeString(d.Outbound[name].WireHex)
		if err != nil {
			t.Fatal(err)
		}
		h, err := DecodeHeader(b)
		if err != nil {
			t.Fatal(err)
		}
		if int(h.Size) != len(b) {
			t.Fatalf("%s: header size %d != %d", name, h.Size, len(b))
		}
		return h, b[HeaderSize:]
	}

	t.Run("account_login", func(t *testing.T) {
		h, b := frame("account_login")
		var l struct {
			Pass    string   `json:"pass"`
			Account string   `json:"account"`
			Force   int32    `json:"force"`
			Mac     [4]int64 `json:"mac"`
		}
		mustJSON(t, d.Outbound["account_login"].Logical, &l)
		var m MsgAccountLoginBody
		if h.Type != MsgAccountLogin || len(b) != MsgAccountLoginBodySize || m.Decode(b) != nil {
			t.Fatalf("type %v len %d", h.Type, len(b))
		}
		if cstr16(m.AccountName[:]) != l.Account || string(m.AccountPassword[:len(l.Pass)]) != l.Pass ||
			m.ClientVersion != d.ClientVersion || m.DBNeedSave != l.Force {
			t.Fatalf("decoded %+v", m)
		}
		for i, v := range l.Mac {
			if m.AdapterName[i] != int32(uint32(v)) {
				t.Fatalf("adapter[%d] = %d", i, m.AdapterName[i])
			}
		}
		for _, z := range m.Zero {
			if z != 0 {
				t.Fatal("reserved bytes not zero")
			}
		}
	})
	t.Run("character_login", func(t *testing.T) {
		h, b := frame("character_login")
		var m MsgCharacterLoginBody
		if h.Type != MsgCharacterLogin || len(b) != 8 || m.Decode(b) != nil || m.Slot != 2 || m.Force != 0 {
			t.Fatalf("type %v len %d %+v", h.Type, len(b), m)
		}
	})
	t.Run("account_secure", func(t *testing.T) {
		h, b := frame("account_secure")
		var m MsgAccountSecureBody
		if h.Type != MsgAccountSecure || len(b) != MsgAccountSecureBodySize || m.Decode(b) != nil {
			t.Fatalf("type %v len %d", h.Type, len(b))
		}
		if m.PIN() != "123456" || m.ChangeNumeric != 1 {
			t.Fatalf("decoded change=%d pin length %d", m.ChangeNumeric, len(m.PIN()))
		}
	})
	t.Run("delete_character", func(t *testing.T) {
		h, b := frame("delete_character")
		var m MsgDeleteCharacterBody
		if h.Type != MsgDeleteCharacter || len(b) != MsgDeleteCharacterBodySize || m.Decode(b) != nil {
			t.Fatalf("type %v len %d", h.Type, len(b))
		}
		if m.Slot != 3 || cstr16(m.MobName[:]) != "Cacadora12345" || string(m.Password[:11]) != "12345678901" {
			t.Fatalf("decoded %+v", m)
		}
	})
}
