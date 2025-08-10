FROM oven/bun:1.2.19-slim AS build

WORKDIR /app

COPY package.json ./
COPY bun.lock ./
COPY tsconfig.json ./

RUN bun install

COPY src ./src

RUN bun build --compile --minify-whitespace --minify-syntax --target bun --outfile /server ./src/index.ts

FROM gcr.io/distroless/base AS production

COPY --from=build /server /server

ENV NODE_ENV=production

ENTRYPOINT [ "/server" ]
