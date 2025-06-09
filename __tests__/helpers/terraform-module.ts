import { TerraformModule } from '@/terraform-module';
import type { CommitDetails, GitHubRelease } from '@/types';

/**
 * Helper function to create a TerraformModule instance for testing.
 *
 * @param options - Configuration options for the mock module
 * @param options.directory - Required directory path for the module
 * @param options.latestTag - Optional latest tag for the module
 * @param options.commits - Optional array of commit details
 * @param options.commitMessages - Optional array of commit messages (will create commits)
 * @param options.tags - Optional array of tags
 * @param options.releases - Optional array of releases
 * @returns A configured TerraformModule instance for testing
 */
export function createMockTerraformModule(options: {
  directory: string;
  commits?: CommitDetails[];
  commitMessages?: string[];
  tags?: string[];
  releases?: GitHubRelease[];
}): TerraformModule {
  const { directory, commits = [], commitMessages = [], tags = [], releases = [] } = options;

  const module = new TerraformModule(directory);

  // Add commits from commitMessages
  for (const [index, message] of commitMessages.entries()) {
    const commit: CommitDetails = {
      sha: `commit${index + 1}`,
      message,
      files: [`${directory}/main.tf`],
    };
    module.addCommit(commit);
  }

  // Add commits from commits array
  for (const commit of commits) {
    module.addCommit(commit);
  }

  module.setTags(tags);
  module.setReleases(releases);

  return module;
}
