import { gql, GraphQLClient } from "graphql-request";
import { cli } from "cli-ux";
import chalk from "chalk";
import jwtDecode from "jwt-decode";
import tar from "tar";
import globby from "globby";
import FormData from "form-data";
import got, { HTTPError } from "got";
import getStream from "get-stream";
import pWaitFor from "p-wait-for";

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
      namespace
      builds(orderBy: CREATED_AT_DESC, first: 1) {
        nodes {
          result
        }
      }
      team {
        name
      }
      postSource {
        fields
        url
      }
    }
  }
`;

const CREATE_BUILD = gql`
  mutation($deploymentId: UUID!) {
    createBuild(input: { build: { deploymentId: $deploymentId } }) {
      build {
        id
      }
    }
  }
`;

const GET_BUILD = gql`
  query($id: UUID!) {
    build(id: $id) {
      result
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
      namespace,
      team,
      builds,
    },
  } = await client.request(GET_DEPLOYMENT, { id });

  if (builds.nodes[0] && !builds.nodes[0].result)
    fail(
      "Deployment already building, please wait for it to finish before redeploying."
    );

  actionSuccess();

  cli.log(`Using deployment ${blue(namespace)} of team ${blue(team.name)}`);

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
    createBuild: { build },
  } = await client.request(CREATE_BUILD, { deploymentId: id });
  await pWaitFor(
    async () => {
      const {
        build: { result },
      } = await client.request(GET_BUILD, build);
      if (!result) return false;
      if (result.error) fail(`Deployement failed:\n${result.error.message}`);
      return true;
    },
    { before: false, interval: 5000 }
  );
  actionSuccess();
};
