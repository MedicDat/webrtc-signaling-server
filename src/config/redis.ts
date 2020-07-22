import log from 'loglevel';
import redis from "redis";
import fs from "fs";
import sha512 from "js-sha512";
import { promisify } from "util";

const client = redis.createClient();
const getAsync = promisify(client.get).bind(client);
 
client.on("error", function(error) {
  log.error(error);
});

client.auth(sha512.sha512(fs.readFileSync("/etc/redis/redis_pass").toString()));

export default async function getJWTInfos() {
  const issuer = await getAsync("JWT_ISSUER");
  const secret = await getAsync("JWT_SECRET");
  if (secret == null || issuer == null) throw "issuer or secret not set in redis db!";
  return {
    jwtIssuer: issuer,
    jwtSecret: secret
  };
}