import log from 'loglevel';
import redis from "redis";
import fs from "fs";
import sha512 from "js-sha512";
import { promisify } from "util";

export default class RedisConn {
  client = redis.createClient();
  getAsync = promisify(this.client.get).bind(this.client);

  constructor() {
    this.client.on("error", function (error) {
      log.error(error);
    });

    this.client.auth(sha512.sha512(fs.readFileSync("/etc/redis/redis_pass").toString()));
  }

  async getJWTInfos() {
    const issuer = await this.getAsync("JWT_ISSUER");
    const secret = await this.getAsync("JWT_SECRET");
    if (secret == null || issuer == null) throw "issuer or secret not set in redis db!";
    return {
      jwtIssuer: issuer,
      jwtSecret: secret
    };
  }

  async get(key: string) {
    const res = await this.getAsync(key);
    if (res == null) throw `key ${key} is not set!`;
    return res;
  }
}