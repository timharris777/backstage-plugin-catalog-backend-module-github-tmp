import { Config } from '@backstage/config';
import { GithubCredentialsProvider, ScmIntegrationRegistry, GitHubIntegrationConfig } from '@backstage/integration';
import { CatalogProcessor, LocationSpec, CatalogProcessorEmit, EntityProvider, EntityProviderConnection } from '@backstage/plugin-catalog-backend';
import { Logger } from 'winston';
import { TaskRunner } from '@backstage/backend-tasks';

/**
 * Extracts repositories out of a GitHub org.
 *
 * The following will create locations for all projects which have a catalog-info.yaml
 * on the default branch. The first is shorthand for the second.
 *
 *    target: "https://github.com/backstage"
 *    or
 *    target: https://github.com/backstage/*\/blob/-/catalog-info.yaml
 *
 * You may also explicitly specify the source branch:
 *
 *    target: https://github.com/backstage/*\/blob/main/catalog-info.yaml
 *
 * @public
 **/
declare class GithubDiscoveryProcessor implements CatalogProcessor {
    private readonly integrations;
    private readonly logger;
    private readonly githubCredentialsProvider;
    static fromConfig(config: Config, options: {
        logger: Logger;
        githubCredentialsProvider?: GithubCredentialsProvider;
    }): GithubDiscoveryProcessor;
    constructor(options: {
        integrations: ScmIntegrationRegistry;
        logger: Logger;
        githubCredentialsProvider?: GithubCredentialsProvider;
    });
    getProcessorName(): string;
    readLocation(location: LocationSpec, _optional: boolean, emit: CatalogProcessorEmit): Promise<boolean>;
}

/**
 * The configuration parameters for a multi-org GitHub processor.
 * @public
 */
declare type GithubMultiOrgConfig = Array<{
    /**
     * The name of the GitHub org to process.
     */
    name: string;
    /**
     * The namespace of the group created for this org.
     */
    groupNamespace: string;
    /**
     * The namespace of the users created for this org. If not specified defaults to undefined.
     */
    userNamespace: string | undefined;
}>;

/**
 * Extracts teams and users out of a multiple GitHub orgs namespaced per org.
 *
 * Be aware that this processor may not be compatible with future org structures in the catalog.
 *
 * @public
 */
declare class GithubMultiOrgReaderProcessor implements CatalogProcessor {
    private readonly integrations;
    private readonly orgs;
    private readonly logger;
    private readonly githubCredentialsProvider;
    static fromConfig(config: Config, options: {
        logger: Logger;
        githubCredentialsProvider?: GithubCredentialsProvider;
    }): GithubMultiOrgReaderProcessor;
    constructor(options: {
        integrations: ScmIntegrationRegistry;
        logger: Logger;
        orgs: GithubMultiOrgConfig;
        githubCredentialsProvider?: GithubCredentialsProvider;
    });
    getProcessorName(): string;
    readLocation(location: LocationSpec, _optional: boolean, emit: CatalogProcessorEmit): Promise<boolean>;
    private getAllOrgs;
}

/**
 * Extracts teams and users out of a GitHub org.
 *
 * @remarks
 *
 * Consider using {@link GitHubOrgEntityProvider} instead.
 *
 * @public
 */
declare class GithubOrgReaderProcessor implements CatalogProcessor {
    private readonly integrations;
    private readonly logger;
    private readonly githubCredentialsProvider;
    static fromConfig(config: Config, options: {
        logger: Logger;
        githubCredentialsProvider?: GithubCredentialsProvider;
    }): GithubOrgReaderProcessor;
    constructor(options: {
        integrations: ScmIntegrationRegistry;
        logger: Logger;
        githubCredentialsProvider?: GithubCredentialsProvider;
    });
    getProcessorName(): string;
    readLocation(location: LocationSpec, _optional: boolean, emit: CatalogProcessorEmit): Promise<boolean>;
    private createClient;
}

/**
 * Discovers catalog files located in [GitHub](https://github.com).
 * The provider will search your GitHub account and register catalog files matching the configured path
 * as Location entity and via following processing steps add all contained catalog entities.
 * This can be useful as an alternative to static locations or manually adding things to the catalog.
 *
 * @public
 */
declare class GitHubEntityProvider implements EntityProvider {
    private readonly config;
    private readonly logger;
    private readonly integration;
    private readonly scheduleFn;
    private connection?;
    private readonly githubCredentialsProvider;
    static fromConfig(config: Config, options: {
        logger: Logger;
        schedule: TaskRunner;
    }): GitHubEntityProvider[];
    private constructor();
    /** {@inheritdoc @backstage/plugin-catalog-backend#EntityProvider.getProviderName} */
    getProviderName(): string;
    /** {@inheritdoc @backstage/plugin-catalog-backend#EntityProvider.connect} */
    connect(connection: EntityProviderConnection): Promise<void>;
    private createScheduleFn;
    refresh(logger: Logger): Promise<void>;
    private findCatalogFiles;
    private matchesFilters;
    private createLocationUrl;
    private static toLocationSpec;
}

/**
 * Options for {@link GitHubOrgEntityProvider}.
 *
 * @public
 */
interface GitHubOrgEntityProviderOptions {
    /**
     * A unique, stable identifier for this provider.
     *
     * @example "production"
     */
    id: string;
    /**
     * The target that this provider should consume.
     *
     * @example "https://github.com/backstage"
     */
    orgUrl: string;
    /**
     * The refresh schedule to use.
     *
     * @defaultValue "manual"
     * @remarks
     *
     * If you pass in 'manual', you are responsible for calling the `read` method
     * manually at some interval.
     *
     * But more commonly you will pass in the result of
     * {@link @backstage/backend-tasks#PluginTaskScheduler.createScheduledTaskRunner}
     * to enable automatic scheduling of tasks.
     */
    schedule?: 'manual' | TaskRunner;
    /**
     * The logger to use.
     */
    logger: Logger;
    /**
     * Optionally supply a custom credentials provider, replacing the default one.
     */
    githubCredentialsProvider?: GithubCredentialsProvider;
}
/**
 * Ingests org data (users and groups) from GitHub.
 *
 * @public
 */
declare class GitHubOrgEntityProvider implements EntityProvider {
    private options;
    private readonly credentialsProvider;
    private connection?;
    private scheduleFn?;
    static fromConfig(config: Config, options: GitHubOrgEntityProviderOptions): GitHubOrgEntityProvider;
    constructor(options: {
        id: string;
        orgUrl: string;
        gitHubConfig: GitHubIntegrationConfig;
        logger: Logger;
        githubCredentialsProvider?: GithubCredentialsProvider;
    });
    /** {@inheritdoc @backstage/plugin-catalog-backend#EntityProvider.getProviderName} */
    getProviderName(): string;
    /** {@inheritdoc @backstage/plugin-catalog-backend#EntityProvider.connect} */
    connect(connection: EntityProviderConnection): Promise<void>;
    /**
     * Runs one single complete ingestion. This is only necessary if you use
     * manual scheduling.
     */
    read(options?: {
        logger?: Logger;
    }): Promise<void>;
    private schedule;
}

export { GitHubEntityProvider, GitHubOrgEntityProvider, GitHubOrgEntityProviderOptions, GithubDiscoveryProcessor, GithubMultiOrgConfig, GithubMultiOrgReaderProcessor, GithubOrgReaderProcessor };
