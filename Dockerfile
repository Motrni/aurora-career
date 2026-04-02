FROM node:20-slim

RUN groupadd --gid 2000 app && useradd --uid 2000 --gid 2000 -m -s /bin/bash app

WORKDIR /app

COPY --chown=app:app package.json ./
RUN npm install

COPY --chown=app:app . .
RUN npm run build

USER app

EXPOSE 3000
ENV PORT=3000

CMD npx serve -s dist -l ${PORT:-3000}
