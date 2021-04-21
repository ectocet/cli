import { gql, GraphQLClient } from "graphql-request";
import { cli } from "cli-ux";
import chalk from "chalk";
import jwtDecode from "jwt-decode";
import tar from "tar";
import globby from "globby";
import FormData from "form-data";
import got, { HTTPError } from "got";
import getStream from "get-stream";

const { red, blue, green } = chalk;

export const helpText = `
Pushes the current folder to an Ectocet deployment. Needs ECTOCET_DEPLOY_KEY env var (will ask for it if not provided).
`;

const GET_DEPLOYMENT_TOKEN = gql`
  query($deployKey: UUID!) {
    getDeploymentToken(deployKey: $deployKey)
  }
`;

const GET_DEPLOYMENT = gql`
  query($id: UUID!) {
    deployment(id: $id) {
      id # we need this so the API can compute postSource
      subdomain
      postSource {
        fields
        url
      }
    }
  }
`;

const DEPLOY = gql`
  mutation($id: UUID!) {
    deploy(input: { deploymentId: $id }) {
      success
    }
  }
`;

const fail = (text) => {
  cli.action.stop(red("✘ FAIL"));
  if (text) cli.log(red(text));
  process.exit(1);
};

const actionSuccess = () => cli.action.stop(green("✔ OK"));

const isUuid = (id) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    id
  );

export const main = async () => {
  const apiOrigin = process.env.ECTOCET_ORIGIN || "https://www.ectocet.com";
  const client = new GraphQLClient(`${apiOrigin}/api/graphql`);

  const deployKey =
    process.env.ECTOCET_DEPLOY_KEY ||
    (await cli.prompt("Deploy key", { type: "mask" }));
  if (!isUuid(deployKey)) fail("Invalid deploy key");

  cli.action.start("Getting deployment info");
  const {
    getDeploymentToken: token,
  } = await client.request(GET_DEPLOYMENT_TOKEN, { deployKey });
  if (!token) fail("Invalid deploy key");
  const id = jwtDecode(token).sub;
  client.setHeader("Authorization", `Bearer ${token}`);
  const {
    deployment: {
      postSource: { fields, url },
      subdomain,
    },
  } = await client.request(GET_DEPLOYMENT, { id });
  actionSuccess();

  cli.log(`Using deployment ${blue(subdomain)}`);

  cli.action.start("Packing code");
  const packedFiles = await globby(".", {
    gitignore: true,
    dot: true,
    ignore: ["**/.git"],
  });
  const tarball = await getStream.buffer(tar.c({ gzip: true }, packedFiles));
  actionSuccess();

  cli.action.start("Uploading code");
  const body = new FormData();
  Object.entries(fields).forEach(([name, value]) => body.append(name, value));
  body.append("file", tarball, { knownLength: tarball.length });
  try {
    await got.post(url, { body });
  } catch (e) {
    if (e instanceof HTTPError) fail(e.response.body);
    throw e;
  }
  actionSuccess();

  cli.action.start("Launching deployment");
  const {
    deploy: { success },
  } = await client.request(DEPLOY, { id });
  if (success) actionSuccess();
  else fail("Already deploying");
};
