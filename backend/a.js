import bcrypt from "bcryptjs";

const password = "password";
const salt = await bcrypt.genSaltSync(10);
const hash = bcrypt.hashSync(password, salt);

console.log(hash)