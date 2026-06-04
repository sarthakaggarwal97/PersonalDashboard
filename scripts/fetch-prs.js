#!/usr/bin/env node

const https = require("https");
const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "..", "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const GITHUB_USER = process.env.DASHBOARD_USER || config.github_user;
const ORG = config.org;
const TOKEN = process.env.GITHUB_TOKEN || "";

function request(url) {
  return new Promise((resolve, reject) => {
    const headers = {
      "User-Agent": "PersonalDashboard/1.0",
      Accept: "application/vnd.github+json",
    };
    if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

    https
      .get(url, { headers }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
            return;
          }
          resolve({ body: JSON.parse(body), headers: res.headers });
        });
      })
      .on("error", reject);
  });
}

async function searchAll(query) {
  const items = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `https://api.github.com/search/issues?q=${encodeURIComponent(query)}&per_page=${perPage}&page=${page}&sort=updated&order=desc`;
    const { body } = await request(url);
    items.push(...body.items);
    if (items.length >= body.total_count || body.items.length < perPage) break;
    page++;
  }
  return items;
}

function mapPR(item) {
  const repoFull = item.repository_url.split("/");
  const repo = repoFull[repoFull.length - 1];
  return {
    title: item.title,
    number: item.number,
    repo,
    url: item.html_url,
    author: item.user.login,
    avatar: item.user.avatar_url,
    created: item.created_at.slice(0, 10),
    updated: item.updated_at.slice(0, 10),
    closed: item.closed_at ? item.closed_at.slice(0, 10) : "",
    comments: item.comments,
    draft: item.draft || false,
    merged: item.pull_request?.merged_at != null,
  };
}

function mapMention(item) {
  const repoFull = item.repository_url.split("/");
  const repo = repoFull[repoFull.length - 1];
  return {
    title: item.title,
    number: item.number,
    repo,
    url: item.html_url,
    author: item.user.login,
    avatar: item.user.avatar_url,
    created: item.created_at.slice(0, 10),
    updated: item.updated_at.slice(0, 10),
    is_pr: !!item.pull_request,
    state: item.state,
  };
}

async function main() {
  console.log("Fetching PRs awaiting review...");
  const reviewItems = await searchAll(
    `review-requested:${GITHUB_USER} is:pr is:open org:${ORG}`
  );

  console.log("Fetching open PRs...");
  const openItems = await searchAll(
    `author:${GITHUB_USER} is:pr is:open org:${ORG}`
  );

  console.log("Fetching closed PRs...");
  const closedItems = await searchAll(
    `author:${GITHUB_USER} is:pr is:closed org:${ORG}`
  );

  console.log("Fetching PRs you reviewed...");
  const reviewedByItems = await searchAll(
    `reviewed-by:${GITHUB_USER} is:pr is:closed org:${ORG} -author:${GITHUB_USER}`
  );

  console.log("Fetching mentions...");
  const mentionItems = await searchAll(
    `mentions:${GITHUB_USER} is:open org:${ORG} -author:${GITHUB_USER}`
  );

  console.log("Fetching assigned issues...");
  const assignedIssueItems = await searchAll(
    `assignee:${GITHUB_USER} is:issue is:open org:${ORG}`
  );

  console.log("Fetching authored issues...");
  const authoredIssueItems = await searchAll(
    `author:${GITHUB_USER} is:issue is:open org:${ORG}`
  );

  const toReview = reviewItems.map(mapPR);
  const openPrs = openItems.map(mapPR);
  const closedPrs = closedItems.map(mapPR);
  const reviewedBy = reviewedByItems.map(mapPR);
  const mentions = mentionItems.map(mapMention);

  const assignedIssues = assignedIssueItems.map(mapMention);
  const authoredIssues = authoredIssueItems.map(mapMention);
  const issuesSeen = new Set();
  const issues = [...assignedIssues, ...authoredIssues].filter((i) => {
    if (issuesSeen.has(i.url)) return false;
    issuesSeen.add(i.url);
    return true;
  });

  const repos = [
    ...new Set([...toReview, ...openPrs, ...closedPrs, ...reviewedBy, ...mentions, ...issues].map((pr) => pr.repo)),
  ].sort();

  const data = {
    github_user: GITHUB_USER,
    updated: new Date().toISOString().slice(0, 10),
    to_review: toReview,
    open_prs: openPrs,
    closed_prs: closedPrs,
    reviewed_by: reviewedBy,
    mentions,
    issues,
    repos,
    counts: {
      to_review: toReview.length,
      open: openPrs.length,
      closed: closedPrs.length,
      reviewed_by: reviewedBy.length,
      mentions: mentions.length,
      issues: issues.length,
    },
  };

  const outPath = path.join(__dirname, "..", "data", "prs.json");
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(
    `Done. ${data.counts.to_review} to review, ${data.counts.open} open, ${data.counts.closed} closed, ${data.counts.mentions} mentions. Written to data/prs.json`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
