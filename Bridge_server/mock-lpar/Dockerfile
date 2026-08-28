FROM node:20-alpine

WORKDIR /app

# Only copy what the mock LPAR needs — no bridge deps required.
# mock-lpar.js reads jcl/programs/*.jcl at startup (loadJclMember), so the
# JCL members have to be in the image too, not just the script.
COPY mock-lpar/mock-lpar.js ./mock-lpar/mock-lpar.js
COPY mock-lpar/jcl/ ./mock-lpar/jcl/

RUN addgroup -S mocklpar && adduser -S mocklpar -G mocklpar
USER mocklpar

EXPOSE 3270

ENV MOCK_PORT=3270 \
    MOCK_SYSID=MOCKPROD \
    MOCK_LU=MOCKLU01 \
    LOG_LEVEL=info

CMD ["node", "mock-lpar/mock-lpar.js"]
