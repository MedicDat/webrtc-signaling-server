import log from 'loglevel';
import redis from "redis";
import { promisify } from "util";

const client = redis.createClient();
const getAsync = promisify(client.get).bind(client);
 
client.on("error", function(error) {
  log.error(error);
});

export default async function getJWTInfos() {
  return {
    jwtIssuer: await getAsync("JWT_ISSUER"),
    jwtSecret: await getAsync("JWT_SECRET")
  };
}