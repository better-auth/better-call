// @ts-nocheck
import { default as __fd_glob_3 } from "../content/docs/meta.json?collection=meta"
import * as __fd_glob_2 from "../content/docs/index.mdx?collection=docs"
import * as __fd_glob_1 from "../content/docs/getting-started.mdx?collection=docs"
import * as __fd_glob_0 from "../content/docs/experimental-ui.mdx?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();

export const docs = await create.doc("docs", "content/docs", {"experimental-ui.mdx": __fd_glob_0, "getting-started.mdx": __fd_glob_1, "index.mdx": __fd_glob_2, });

export const meta = await create.meta("meta", "content/docs", {"meta.json": __fd_glob_3, });