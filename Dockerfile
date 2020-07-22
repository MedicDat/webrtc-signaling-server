FROM node
COPY . /app/webrtc-signaling-server
RUN cp /etc/redis/redis_pass /etc/redis/redis_pass
WORKDIR /app/webrtc-signaling-server

RUN [ "npm", "i" ]
RUN [ "npm", "audit", "fix", "--force" ]
CMD [ "npm", "start" ]
