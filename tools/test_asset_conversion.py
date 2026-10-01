"""Independent offset checks for 7662 presentation table conversion."""
import struct
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import import_local_assets
from import_local_assets import convert_items, convert_skills, validate_inputs


class ConversionTest(unittest.TestCase):
    def test_first_and_last_item(self):
        source = bytearray(6500 * 140)
        for index in (0, 6499):
            offset = index * 140
            source[offset:offset + 64] = bytes(range(64))
            struct.pack_into('<i', source, offset + 128, -2147483648)
            struct.pack_into('<hHhh', source, offset + 132, -32768, 65535, -32768, 32767)
        result = bytes(v ^ 90 for v in convert_items(bytes(v ^ 90 for v in source) + bytes(4)))
        for index in (0, 6499):
            offset = index * 164
            self.assertEqual(result[offset:offset + 134], source[index * 140:index * 140 + 134])
            self.assertEqual(struct.unpack_from('<hIhh', result, offset + 134), (0, 65535, -32768, 32767))
            self.assertEqual(result[offset + 144:offset + 164], bytes(20))

    def test_first_and_last_skill(self):
        source = bytearray(248 * 96)
        for index in (0, 247):
            source[index * 96:(index + 1) * 96] = bytes(range(96))
        result = bytes(v ^ 90 for v in convert_skills(bytes(v ^ 90 for v in source) + bytes(4)))
        for index in (0, 247):
            self.assertEqual(result[index * 104:index * 104 + 96], bytes(range(96)))
            self.assertEqual(result[index * 104 + 96:(index + 1) * 104], bytes(8))

    def test_required_inputs(self):
        with TemporaryDirectory() as directory:
            selected = {}
            with self.assertRaisesRegex(ValueError, 'required asset missing: ItemList'):
                validate_inputs(selected)
            for name, size in [('ItemList.bin', 910004), ('SkillData.bin', 23812)]:
                path = Path(directory) / name
                path.write_bytes(bytes(size))
                selected[name] = path
            font = Path(directory) / 'font.ttf'
            font.write_bytes(b'not a font')
            selected['Tahoma.ttf'] = font
            with self.assertRaisesRegex(ValueError, 'font must'):
                validate_inputs(selected)

    def test_invalid_table_does_not_copy_music_or_create_dataset(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'
            (source / 'music').mkdir(parents=True)
            (source / 'music/test.mp3').write_bytes(b'synthetic music')
            (source / 'ItemList.bin').write_bytes(b'truncated')
            manifest = root / 'external/OpenWyd/webclient/client-wasm/config/startup-preload-manifest.txt'
            manifest.parent.mkdir(parents=True)
            manifest.write_text('v769ClientRelease/ItemList.bin@/ItemList.bin\n', encoding='utf-8')
            font = source / 'font.ttf'
            font.write_bytes(b'\x00\x01\x00\x00' + bytes(8))
            with patch.object(import_local_assets, 'ROOT', root), patch('sys.argv', [
                'import_local_assets.py', '--assets', str(source), '--font', str(font)
            ]):
                with self.assertRaisesRegex(ValueError, 'ItemList requires'):
                    import_local_assets.main()
            self.assertFalse((root / 'assets-local').exists())

    def test_item_offsets_and_bitmask(self):
        decoded = bytearray(6500 * 140)
        decoded[140:144] = b"Name"
        struct.pack_into("<i", decoded, 140 + 128, 123456)
        struct.pack_into("<hHhh", decoded, 140 + 132, -7, 0x8001, -2, 9)
        encoded = bytes(v ^ 90 for v in decoded) + b"TAIL"
        result = bytes(v ^ 90 for v in convert_items(encoded))
        self.assertEqual(len(result), 6500 * 164)
        self.assertEqual(result[164:168], b"Name")
        self.assertEqual(struct.unpack_from("<ihhIhh", result, 164 + 128),
                         (123456, -7, 0, 0x8001, -2, 9))
        self.assertEqual(result[164 + 144:328], bytes(20))
        self.assertEqual(result[328:492], bytes(164))

    def test_skill_record_boundary_and_absent_fields(self):
        data = bytearray(248 * 96)
        struct.pack_into("<i", data, 96, 48)
        data[96 + 48:96 + 56] = bytes([10, 0, 0, 10, 0, 0, 0, 0])
        struct.pack_into("<i", data, 96 + 92, -1)
        result = bytes(v ^ 90 for v in convert_skills(bytes(v ^ 90 for v in data) + b"TAIL"))
        self.assertEqual(len(result), 248 * 104)
        self.assertEqual(struct.unpack_from("<i", result, 104)[0], 48)
        self.assertEqual(result[152:160], bytes([10, 0, 0, 10, 0, 0, 0, 0]))
        self.assertEqual(struct.unpack_from("<iii", result, 196), (-1, 0, 0))
        self.assertEqual(result[208:312], bytes(104))

    def test_reject_truncated_extra_or_different_dialect(self):
        for converter, length in ((convert_items, 910004), (convert_skills, 23812)):
            for bad in (b"", bytes(length - 1), bytes(length + 1)):
                with self.assertRaises(ValueError):
                    converter(bad)


if __name__ == "__main__":
    unittest.main()
