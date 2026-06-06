import { version } from "./index";
test("package exposes a version", () => expect(typeof version).toBe("string"));
