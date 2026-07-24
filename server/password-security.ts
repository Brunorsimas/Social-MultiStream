import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const ALGORITHM = "scrypt";
const SALT_BYTES = 16;
const KEY_BYTES = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derivedKey = (await scrypt(password, salt, KEY_BYTES)) as Buffer;
  return `${ALGORITHM}$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  storedPassword: string,
): Promise<boolean> {
  const [algorithm, saltHex, hashHex, ...unexpected] =
    storedPassword.split("$");

  if (
    algorithm !== ALGORITHM ||
    unexpected.length > 0 ||
    !/^[a-f0-9]{32}$/i.test(saltHex ?? "") ||
    !/^[a-f0-9]{128}$/i.test(hashHex ?? "")
  ) {
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const storedHash = Buffer.from(hashHex, "hex");
  const suppliedHash = (await scrypt(password, salt, KEY_BYTES)) as Buffer;

  return timingSafeEqual(storedHash, suppliedHash);
}
