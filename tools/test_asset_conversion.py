"""Independent offset checks for 7662 presentation table conversion."""
import struct
import unittest

from import_local_assets import convert_items, convert_skills


class ConversionTest(unittest.TestCase):
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
