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
