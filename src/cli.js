import { gql, GraphQLClient } from "graphql-request";
import { cli } from "cli-ux";
import chalk from "chalk";
import jwtDecode from "jwt-decode";

const { red } = chalk;

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
      postSource {
        fields
        url
      }
    }
  }
`;

const fail = (text) => {
  if (text) cli.log(red(text));
  process.exit(1);
};

const isUuid = (id) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    id
  );

export const main = async () => {
  const apiOrigin = process.env.ECTOCET_ORIGIN || "https://www.ectocet.com";
  const client = new GraphQLClient(`${apiOrigin}/api/graphql`);

  const deployKey =
    process.env.deployKey || (await cli.prompt("Deploy key", { type: "mask" }));

  if (!isUuid(deployKey)) fail("Invalid deploy key");

  cli.action.start("Getting deployment info");

  const {
    getDeploymentToken: token,
  } = await client.request(GET_DEPLOYMENT_TOKEN, { deployKey });

  if (!token) {
    cli.action.stop(red("failed"));
    fail("Invalid deploy key");
  }

  const id = jwtDecode(token).sub;

  const { deployment } = await client.request(
    GET_DEPLOYMENT,
    { id },
    { Authorization: `Bearer ${token}` }
  );

  cli.action.stop();

  cli.log(deployment);
};
