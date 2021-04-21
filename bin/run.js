#!/usr/bin/env node

import { config } from "dotenv";
import meow from "meow";
import { helpText, main } from "../src/cli.js";

config();

main(meow(helpText));
