'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var integration = require('@backstage/integration');
var pluginCatalogBackend = require('@backstage/plugin-catalog-backend');
var graphql = require('@octokit/graphql');
var uuid = require('uuid');
var catalogModel = require('@backstage/catalog-model');
var lodash = require('lodash');

function _interopNamespace(e) {
  if (e && e.__esModule) return e;
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () { return e[k]; }
        });
      }
    });
  }
  n["default"] = e;
  return Object.freeze(n);
}

var uuid__namespace = /*#__PURE__*/_interopNamespace(uuid);

function readGithubMultiOrgConfig(config) {
  var _a;
  const orgConfigs = (_a = config.getOptionalConfigArray("orgs")) != null ? _a : [];
  return orgConfigs.map((c) => {
    var _a2, _b;
    return {
      name: c.getString("name"),
      groupNamespace: ((_a2 = c.getOptionalString("groupNamespace")) != null ? _a2 : c.getString("name")).toLowerCase(),
      userNamespace: (_b = c.getOptionalString("userNamespace")) != null ? _b : void 0
    };
  });
}

async function getOrganizationUsers(client, org, tokenType, userNamespace) {
  const query = `
    query users($org: String!, $email: Boolean!, $cursor: String) {
      organization(login: $org) {
        membersWithRole(first: 100, after: $cursor) {
          pageInfo { hasNextPage, endCursor }
          nodes {
            avatarUrl,
            bio,
            email @include(if: $email),
            login,
            name
          }
        }
      }
    }`;
  const mapper = (user) => {
    const entity = {
      apiVersion: "backstage.io/v1alpha1",
      kind: "User",
      metadata: {
        name: user.login,
        annotations: {
          "github.com/user-login": user.login
        }
      },
      spec: {
        profile: {},
        memberOf: []
      }
    };
    if (userNamespace)
      entity.metadata.namespace = userNamespace;
    if (user.bio)
      entity.metadata.description = user.bio;
    if (user.name)
      entity.spec.profile.displayName = user.name;
    if (user.email)
      entity.spec.profile.email = user.email;
    if (user.avatarUrl)
      entity.spec.profile.picture = user.avatarUrl;
    return entity;
  };
  const users = await queryWithPaging(
    client,
    query,
    (r) => {
      var _a;
      return (_a = r.organization) == null ? void 0 : _a.membersWithRole;
    },
    mapper,
    { org, email: tokenType === "token" }
  );
  return { users };
}
async function getOrganizationTeams(client, org, orgNamespace) {
  const query = `
    query teams($org: String!, $cursor: String) {
      organization(login: $org) {
        teams(first: 100, after: $cursor) {
          pageInfo { hasNextPage, endCursor }
          nodes {
            slug
            combinedSlug
            name
            description
            avatarUrl
            editTeamUrl
            parentTeam { slug }
            members(first: 100, membership: IMMEDIATE) {
              pageInfo { hasNextPage }
              nodes { login }
            }
          }
        }
      }
    }`;
  const groupMemberUsers = /* @__PURE__ */ new Map();
  const mapper = async (team) => {
    const annotations = {
      "github.com/team-slug": team.combinedSlug
    };
    if (team.editTeamUrl) {
      annotations["backstage.io/edit-url"] = team.editTeamUrl;
    }
    const entity = {
      apiVersion: "backstage.io/v1alpha1",
      kind: "Group",
      metadata: {
        name: team.slug,
        annotations
      },
      spec: {
        type: "team",
        profile: {},
        children: []
      }
    };
    if (orgNamespace) {
      entity.metadata.namespace = orgNamespace;
    }
    if (team.description) {
      entity.metadata.description = team.description;
    }
    if (team.name) {
      entity.spec.profile.displayName = team.name;
    }
    if (team.avatarUrl) {
      entity.spec.profile.picture = team.avatarUrl;
    }
    if (team.parentTeam) {
      entity.spec.parent = team.parentTeam.slug;
    }
    const memberNames = [];
    const groupKey = orgNamespace ? `${orgNamespace}/${team.slug}` : team.slug;
    groupMemberUsers.set(groupKey, memberNames);
    if (!team.members.pageInfo.hasNextPage) {
      for (const user of team.members.nodes) {
        memberNames.push(user.login);
      }
    } else {
      const { members } = await getTeamMembers(client, org, team.slug);
      for (const userLogin of members) {
        memberNames.push(userLogin);
      }
    }
    return entity;
  };
  const groups = await queryWithPaging(
    client,
    query,
    (r) => {
      var _a;
      return (_a = r.organization) == null ? void 0 : _a.teams;
    },
    mapper,
    { org }
  );
  return { groups, groupMemberUsers };
}
async function getOrganizationRepositories(client, org) {
  const query = `
    query repositories($org: String!, $cursor: String) {
      repositoryOwner(login: $org) {
        login
        repositories(first: 100, after: $cursor) {
          nodes {
            name
            url
            isArchived
            defaultBranchRef {
              name
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }`;
  const repositories = await queryWithPaging(
    client,
    query,
    (r) => {
      var _a;
      return (_a = r.repositoryOwner) == null ? void 0 : _a.repositories;
    },
    (x) => x,
    { org }
  );
  return { repositories };
}
async function getTeamMembers(client, org, teamSlug) {
  const query = `
    query members($org: String!, $teamSlug: String!, $cursor: String) {
      organization(login: $org) {
        team(slug: $teamSlug) {
          members(first: 100, after: $cursor, membership: IMMEDIATE) {
            pageInfo { hasNextPage, endCursor }
            nodes { login }
          }
        }
      }
    }`;
  const members = await queryWithPaging(
    client,
    query,
    (r) => {
      var _a, _b;
      return (_b = (_a = r.organization) == null ? void 0 : _a.team) == null ? void 0 : _b.members;
    },
    (user) => user.login,
    { org, teamSlug }
  );
  return { members };
}
async function queryWithPaging(client, query, connection, mapper, variables) {
  const result = [];
  let cursor = void 0;
  for (let j = 0; j < 1e3; ++j) {
    const response = await client(query, {
      ...variables,
      cursor
    });
    const conn = connection(response);
    if (!conn) {
      throw new Error(`Found no match for ${JSON.stringify(variables)}`);
    }
    for (const node of conn.nodes) {
      result.push(await mapper(node));
    }
    if (!conn.pageInfo.hasNextPage) {
      break;
    } else {
      cursor = conn.pageInfo.endCursor;
    }
  }
  return result;
}

function buildOrgHierarchy(groups) {
  const groupsByName = new Map(groups.map((g) => [g.metadata.name, g]));
  for (const group of groups) {
    const selfName = group.metadata.name;
    const parentName = group.spec.parent;
    if (parentName) {
      const parent = groupsByName.get(parentName);
      if (parent && !parent.spec.children.includes(selfName)) {
        parent.spec.children.push(selfName);
      }
    }
  }
  for (const group of groups) {
    const selfName = group.metadata.name;
    for (const childName of group.spec.children) {
      const child = groupsByName.get(childName);
      if (child && !child.spec.parent) {
        child.spec.parent = selfName;
      }
    }
  }
}
function assignGroupsToUsers(users, groupMemberUsers) {
  var _a;
  const usersByName = new Map(users.map((u) => [u.metadata.name, u]));
  for (const [groupName, userNames] of groupMemberUsers.entries()) {
    for (const userName of userNames) {
      const user = usersByName.get(userName);
      if (user && !((_a = user.spec.memberOf) == null ? void 0 : _a.includes(groupName))) {
        if (!user.spec.memberOf) {
          user.spec.memberOf = [];
        }
        user.spec.memberOf.push(groupName);
      }
    }
  }
}

function parseGitHubOrgUrl(urlString) {
  const path = new URL(urlString).pathname.substr(1).split("/");
  if (path.length === 1 && path[0].length) {
    return { org: decodeURIComponent(path[0]) };
  }
  throw new Error(`Expected a URL pointing to /<org>`);
}

class GithubDiscoveryProcessor {
  static fromConfig(config, options) {
    const integrations = integration.ScmIntegrations.fromConfig(config);
    return new GithubDiscoveryProcessor({
      ...options,
      integrations
    });
  }
  constructor(options) {
    this.integrations = options.integrations;
    this.logger = options.logger;
    this.githubCredentialsProvider = options.githubCredentialsProvider || integration.DefaultGithubCredentialsProvider.fromIntegrations(this.integrations);
  }
  getProcessorName() {
    return "GithubDiscoveryProcessor";
  }
  async readLocation(location, _optional, emit) {
    var _a, _b;
    if (location.type !== "github-discovery") {
      return false;
    }
    const gitHubConfig = (_a = this.integrations.github.byUrl(
      location.target
    )) == null ? void 0 : _a.config;
    if (!gitHubConfig) {
      throw new Error(
        `There is no GitHub integration that matches ${location.target}. Please add a configuration entry for it under integrations.github`
      );
    }
    const { org, repoSearchPath, catalogPath, branch, host } = parseUrl(
      location.target
    );
    const orgUrl = `https://${host}/${org}`;
    const { headers } = await this.githubCredentialsProvider.getCredentials({
      url: orgUrl
    });
    const client = graphql.graphql.defaults({
      baseUrl: gitHubConfig.apiBaseUrl,
      headers
    });
    const startTimestamp = Date.now();
    this.logger.info(`Reading GitHub repositories from ${location.target}`);
    const { repositories } = await getOrganizationRepositories(client, org);
    const matching = repositories.filter(
      (r) => !r.isArchived && repoSearchPath.test(r.name)
    );
    const duration = ((Date.now() - startTimestamp) / 1e3).toFixed(1);
    this.logger.debug(
      `Read ${repositories.length} GitHub repositories (${matching.length} matching the pattern) in ${duration} seconds`
    );
    for (const repository of matching) {
      const branchName = branch === "-" ? (_b = repository.defaultBranchRef) == null ? void 0 : _b.name : branch;
      if (!branchName) {
        this.logger.info(
          `the repository ${repository.url} does not have a default branch, skipping`
        );
        continue;
      }
      const path = `/blob/${branchName}${catalogPath}`;
      emit(
        pluginCatalogBackend.processingResult.location({
          type: "url",
          target: `${repository.url}${path}`,
          presence: "optional"
        })
      );
    }
    return true;
  }
}
function parseUrl(urlString) {
  const url = new URL(urlString);
  const path = url.pathname.substr(1).split("/");
  if (path.length > 2 && path[0].length && path[1].length) {
    return {
      org: decodeURIComponent(path[0]),
      repoSearchPath: escapeRegExp(decodeURIComponent(path[1])),
      branch: decodeURIComponent(path[3]),
      catalogPath: `/${decodeURIComponent(path.slice(4).join("/"))}`,
      host: url.host
    };
  } else if (path.length === 1 && path[0].length) {
    return {
      org: decodeURIComponent(path[0]),
      host: url.host,
      repoSearchPath: escapeRegExp("*"),
      catalogPath: "/catalog-info.yaml",
      branch: "-"
    };
  }
  throw new Error(`Failed to parse ${urlString}`);
}
function escapeRegExp(str) {
  return new RegExp(`^${str.replace(/\*/g, ".*")}$`);
}

class GithubMultiOrgReaderProcessor {
  static fromConfig(config, options) {
    const c = config.getOptionalConfig("catalog.processors.githubMultiOrg");
    const integrations = integration.ScmIntegrations.fromConfig(config);
    return new GithubMultiOrgReaderProcessor({
      ...options,
      integrations,
      orgs: c ? readGithubMultiOrgConfig(c) : []
    });
  }
  constructor(options) {
    this.integrations = options.integrations;
    this.logger = options.logger;
    this.orgs = options.orgs;
    this.githubCredentialsProvider = options.githubCredentialsProvider || integration.DefaultGithubCredentialsProvider.fromIntegrations(this.integrations);
  }
  getProcessorName() {
    return "GithubMultiOrgReaderProcessor";
  }
  async readLocation(location, _optional, emit) {
    var _a, _b;
    if (location.type !== "github-multi-org") {
      return false;
    }
    const gitHubConfig = (_a = this.integrations.github.byUrl(
      location.target
    )) == null ? void 0 : _a.config;
    if (!gitHubConfig) {
      throw new Error(
        `There is no GitHub integration that matches ${location.target}. Please add a configuration entry for it under integrations.github`
      );
    }
    const allUsersMap = /* @__PURE__ */ new Map();
    const baseUrl = new URL(location.target).origin;
    const orgsToProcess = this.orgs.length ? this.orgs : await this.getAllOrgs(gitHubConfig);
    for (const orgConfig of orgsToProcess) {
      try {
        const { headers, type: tokenType } = await this.githubCredentialsProvider.getCredentials({
          url: `${baseUrl}/${orgConfig.name}`
        });
        const client = graphql.graphql.defaults({
          baseUrl: gitHubConfig.apiBaseUrl,
          headers
        });
        const startTimestamp = Date.now();
        this.logger.info(
          `Reading GitHub users and teams for org: ${orgConfig.name}`
        );
        const { users } = await getOrganizationUsers(
          client,
          orgConfig.name,
          tokenType,
          orgConfig.userNamespace
        );
        const { groups, groupMemberUsers } = await getOrganizationTeams(
          client,
          orgConfig.name,
          orgConfig.groupNamespace
        );
        const duration = ((Date.now() - startTimestamp) / 1e3).toFixed(1);
        this.logger.debug(
          `Read ${users.length} GitHub users and ${groups.length} GitHub teams from ${orgConfig.name} in ${duration} seconds`
        );
        let prefix = (_b = orgConfig.userNamespace) != null ? _b : "";
        if (prefix.length > 0)
          prefix += "/";
        users.forEach((u) => {
          if (!allUsersMap.has(prefix + u.metadata.name)) {
            allUsersMap.set(prefix + u.metadata.name, u);
          }
        });
        for (const [groupName, userNames] of groupMemberUsers.entries()) {
          for (const userName of userNames) {
            const user = allUsersMap.get(prefix + userName);
            if (user && !user.spec.memberOf.includes(groupName)) {
              user.spec.memberOf.push(groupName);
            }
          }
        }
        buildOrgHierarchy(groups);
        for (const group of groups) {
          emit(pluginCatalogBackend.processingResult.entity(location, group));
        }
      } catch (e) {
        this.logger.error(
          `Failed to read GitHub org data for ${orgConfig.name}: ${e}`
        );
      }
    }
    const allUsers = Array.from(allUsersMap.values());
    for (const user of allUsers) {
      emit(pluginCatalogBackend.processingResult.entity(location, user));
    }
    return true;
  }
  async getAllOrgs(gitHubConfig) {
    const githubAppMux = new integration.GithubAppCredentialsMux(gitHubConfig);
    const installs = await githubAppMux.getAllInstallations();
    return installs.map(
      (install) => install.target_type === "Organization" && install.account && install.account.login ? {
        name: install.account.login,
        groupNamespace: install.account.login.toLowerCase()
      } : void 0
    ).filter(Boolean);
  }
}

class GithubOrgReaderProcessor {
  static fromConfig(config, options) {
    const integrations = integration.ScmIntegrations.fromConfig(config);
    return new GithubOrgReaderProcessor({
      ...options,
      integrations
    });
  }
  constructor(options) {
    this.integrations = options.integrations;
    this.githubCredentialsProvider = options.githubCredentialsProvider || integration.DefaultGithubCredentialsProvider.fromIntegrations(this.integrations);
    this.logger = options.logger;
  }
  getProcessorName() {
    return "GithubOrgReaderProcessor";
  }
  async readLocation(location, _optional, emit) {
    if (location.type !== "github-org") {
      return false;
    }
    const { client, tokenType } = await this.createClient(location.target);
    const { org } = parseGitHubOrgUrl(location.target);
    const startTimestamp = Date.now();
    this.logger.info("Reading GitHub users and groups");
    const { users } = await getOrganizationUsers(client, org, tokenType);
    const { groups, groupMemberUsers } = await getOrganizationTeams(
      client,
      org
    );
    const duration = ((Date.now() - startTimestamp) / 1e3).toFixed(1);
    this.logger.debug(
      `Read ${users.length} GitHub users and ${groups.length} GitHub groups in ${duration} seconds`
    );
    assignGroupsToUsers(users, groupMemberUsers);
    buildOrgHierarchy(groups);
    for (const group of groups) {
      emit(pluginCatalogBackend.processingResult.entity(location, group));
    }
    for (const user of users) {
      emit(pluginCatalogBackend.processingResult.entity(location, user));
    }
    return true;
  }
  async createClient(orgUrl) {
    var _a;
    const gitHubConfig = (_a = this.integrations.github.byUrl(orgUrl)) == null ? void 0 : _a.config;
    if (!gitHubConfig) {
      throw new Error(
        `There is no GitHub Org provider that matches ${orgUrl}. Please add a configuration for an integration.`
      );
    }
    const { headers, type: tokenType } = await this.githubCredentialsProvider.getCredentials({
      url: orgUrl
    });
    const client = graphql.graphql.defaults({
      baseUrl: gitHubConfig.apiBaseUrl,
      headers
    });
    return { client, tokenType };
  }
}

const DEFAULT_CATALOG_PATH = "/catalog-info.yaml";
const DEFAULT_PROVIDER_ID = "default";
function readProviderConfigs(config) {
  const providersConfig = config.getOptionalConfig("catalog.providers.github");
  if (!providersConfig) {
    return [];
  }
  if (providersConfig.has("organization")) {
    return [readProviderConfig(DEFAULT_PROVIDER_ID, providersConfig)];
  }
  return providersConfig.keys().map((id) => {
    const providerConfig = providersConfig.getConfig(id);
    return readProviderConfig(id, providerConfig);
  });
}
function readProviderConfig(id, config) {
  var _a;
  const organization = config.getString("organization");
  const catalogPath = (_a = config.getOptionalString("catalogPath")) != null ? _a : DEFAULT_CATALOG_PATH;
  const repositoryPattern = config.getOptionalString("filters.repository");
  const branchPattern = config.getOptionalString("filters.branch");
  return {
    id,
    catalogPath,
    organization,
    filters: {
      repository: repositoryPattern ? compileRegExp(repositoryPattern) : void 0,
      branch: branchPattern || void 0
    }
  };
}
function compileRegExp(pattern) {
  let fullLinePattern = pattern;
  if (!fullLinePattern.startsWith("^")) {
    fullLinePattern = `^${fullLinePattern}`;
  }
  if (!fullLinePattern.endsWith("$")) {
    fullLinePattern = `${fullLinePattern}$`;
  }
  return new RegExp(fullLinePattern);
}

class GitHubEntityProvider {
  static fromConfig(config, options) {
    const integrations = integration.ScmIntegrations.fromConfig(config);
    const integration$1 = integrations.github.byHost("github.com");
    if (!integration$1) {
      throw new Error(
        `There is no GitHub config that matches github. Please add a configuration entry for it under integrations.github`
      );
    }
    return readProviderConfigs(config).map(
      (providerConfig) => new GitHubEntityProvider(
        providerConfig,
        integration$1,
        options.logger,
        options.schedule
      )
    );
  }
  constructor(config, integration$1, logger, schedule) {
    this.config = config;
    this.integration = integration$1.config;
    this.logger = logger.child({
      target: this.getProviderName()
    });
    this.scheduleFn = this.createScheduleFn(schedule);
    this.githubCredentialsProvider = integration.SingleInstanceGithubCredentialsProvider.create(integration$1.config);
    this.scheduleFn = this.createScheduleFn(schedule);
  }
  getProviderName() {
    return `github-provider:${this.config.id}`;
  }
  async connect(connection) {
    this.connection = connection;
    return await this.scheduleFn();
  }
  createScheduleFn(schedule) {
    return async () => {
      const taskId = `${this.getProviderName()}:refresh`;
      return schedule.run({
        id: taskId,
        fn: async () => {
          const logger = this.logger.child({
            class: GitHubEntityProvider.prototype.constructor.name,
            taskId,
            taskInstanceId: uuid__namespace.v4()
          });
          try {
            await this.refresh(logger);
          } catch (error) {
            logger.error(error);
          }
        }
      });
    };
  }
  async refresh(logger) {
    if (!this.connection) {
      throw new Error("Not initialized");
    }
    const targets = await this.findCatalogFiles();
    const matchingTargets = this.matchesFilters(targets);
    const entities = matchingTargets.map((repository) => this.createLocationUrl(repository)).map(GitHubEntityProvider.toLocationSpec).map((location) => {
      return {
        locationKey: this.getProviderName(),
        entity: pluginCatalogBackend.locationSpecToLocationEntity({ location })
      };
    });
    await this.connection.applyMutation({
      type: "full",
      entities
    });
    logger.info(
      `Read ${targets.length} GitHub repositories (${entities.length} matching the pattern)`
    );
  }
  async findCatalogFiles() {
    const organization = this.config.organization;
    const host = this.integration.host;
    const orgUrl = `https://${host}/${organization}`;
    const { headers } = await this.githubCredentialsProvider.getCredentials({
      url: orgUrl
    });
    const client = graphql.graphql.defaults({
      baseUrl: this.integration.apiBaseUrl,
      headers
    });
    const { repositories } = await getOrganizationRepositories(
      client,
      organization
    );
    return repositories;
  }
  matchesFilters(repositories) {
    var _a;
    const repositoryFilter = (_a = this.config.filters) == null ? void 0 : _a.repository;
    const matchingRepositories = repositories.filter((r) => {
      var _a2;
      return (
        !r.isArchived &&
        (!repositoryFilter || repositoryFilter.test(r.name)) &&
        r.defaultBranchRef?.name
      );
    });
    return matchingRepositories;
  }
  createLocationUrl(repository) {
    var _a, _b;
    const branch = ((_a = this.config.filters) == null ? void 0 : _a.branch) || ((_b = repository.defaultBranchRef) == null ? void 0 : _b.name) || "-";
    const catalogFile = this.config.catalogPath.startsWith("/") ? this.config.catalogPath.substring(1) : this.config.catalogPath;
    return `${repository.url}/blob/${branch}/${catalogFile}`;
  }
  static toLocationSpec(target) {
    return {
      type: "url",
      target,
      presence: "optional"
    };
  }
}

class GitHubOrgEntityProvider {
  constructor(options) {
    this.options = options;
    this.credentialsProvider = options.githubCredentialsProvider || integration.SingleInstanceGithubCredentialsProvider.create(this.options.gitHubConfig);
  }
  static fromConfig(config, options) {
    var _a;
    const integrations = integration.ScmIntegrations.fromConfig(config);
    const gitHubConfig = (_a = integrations.github.byUrl(options.orgUrl)) == null ? void 0 : _a.config;
    if (!gitHubConfig) {
      throw new Error(
        `There is no GitHub Org provider that matches ${options.orgUrl}. Please add a configuration for an integration.`
      );
    }
    const logger = options.logger.child({
      target: options.orgUrl
    });
    const provider = new GitHubOrgEntityProvider({
      id: options.id,
      orgUrl: options.orgUrl,
      logger,
      gitHubConfig,
      githubCredentialsProvider: options.githubCredentialsProvider || integration.DefaultGithubCredentialsProvider.fromIntegrations(integrations)
    });
    provider.schedule(options.schedule);
    return provider;
  }
  getProviderName() {
    return `GitHubOrgEntityProvider:${this.options.id}`;
  }
  async connect(connection) {
    var _a;
    this.connection = connection;
    await ((_a = this.scheduleFn) == null ? void 0 : _a.call(this));
  }
  async read(options) {
    var _a;
    if (!this.connection) {
      throw new Error("Not initialized");
    }
    const logger = (_a = options == null ? void 0 : options.logger) != null ? _a : this.options.logger;
    const { markReadComplete } = trackProgress(logger);
    const { headers, type: tokenType } = await this.credentialsProvider.getCredentials({
      url: this.options.orgUrl
    });
    const client = graphql.graphql.defaults({
      baseUrl: this.options.gitHubConfig.apiBaseUrl,
      headers
    });
    const { org } = parseGitHubOrgUrl(this.options.orgUrl);
    const { users } = await getOrganizationUsers(client, org, tokenType);
    const { groups, groupMemberUsers } = await getOrganizationTeams(
      client,
      org
    );
    assignGroupsToUsers(users, groupMemberUsers);
    buildOrgHierarchy(groups);
    const { markCommitComplete } = markReadComplete({ users, groups });
    await this.connection.applyMutation({
      type: "full",
      entities: [...users, ...groups].map((entity) => ({
        locationKey: `github-org-provider:${this.options.id}`,
        entity: withLocations(
          `https://${this.options.gitHubConfig.host}`,
          org,
          entity
        )
      }))
    });
    markCommitComplete();
  }
  schedule(schedule) {
    if (!schedule || schedule === "manual") {
      return;
    }
    this.scheduleFn = async () => {
      const id = `${this.getProviderName()}:refresh`;
      await schedule.run({
        id,
        fn: async () => {
          const logger = this.options.logger.child({
            class: GitHubOrgEntityProvider.prototype.constructor.name,
            taskId: id,
            taskInstanceId: uuid__namespace.v4()
          });
          try {
            await this.read({ logger });
          } catch (error) {
            logger.error(error);
          }
        }
      });
    };
  }
}
function trackProgress(logger) {
  let timestamp = Date.now();
  let summary;
  logger.info("Reading GitHub users and groups");
  function markReadComplete(read) {
    summary = `${read.users.length} GitHub users and ${read.groups.length} GitHub groups`;
    const readDuration = ((Date.now() - timestamp) / 1e3).toFixed(1);
    timestamp = Date.now();
    logger.info(`Read ${summary} in ${readDuration} seconds. Committing...`);
    return { markCommitComplete };
  }
  function markCommitComplete() {
    const commitDuration = ((Date.now() - timestamp) / 1e3).toFixed(1);
    logger.info(`Committed ${summary} in ${commitDuration} seconds.`);
  }
  return { markReadComplete };
}
function withLocations(baseUrl, org, entity) {
  const location = entity.kind === "Group" ? `url:${baseUrl}/orgs/${org}/teams/${entity.metadata.name}` : `url:${baseUrl}/${entity.metadata.name}`;
  return lodash.merge(
    {
      metadata: {
        annotations: {
          [catalogModel.ANNOTATION_LOCATION]: location,
          [catalogModel.ANNOTATION_ORIGIN_LOCATION]: location
        }
      }
    },
    entity
  );
}

exports.GitHubEntityProvider = GitHubEntityProvider;
exports.GitHubOrgEntityProvider = GitHubOrgEntityProvider;
exports.GithubDiscoveryProcessor = GithubDiscoveryProcessor;
exports.GithubMultiOrgReaderProcessor = GithubMultiOrgReaderProcessor;
exports.GithubOrgReaderProcessor = GithubOrgReaderProcessor;
//# sourceMappingURL=index.cjs.js.map
