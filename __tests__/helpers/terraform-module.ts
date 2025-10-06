import { TerraformModule } from '@/terraform-module';
import type { CommitDetails, GitHubRelease, GitHubTag } from '@/types';

/**
 * Helper function to create a GitHubTag from a tag name.
 * Generates a fake commit SHA for testing purposes.
 *
 * @param name - The tag name
 * @param commitSHA - Optional commit SHA (defaults to a hash of the tag name)
 * @returns A GitHubTag object
 */
export function createMockTag(name: string, commitSHA?: string): GitHubTag {
  // Generate a simple hash if no SHA provided
  const defaultSHA = commitSHA ?? `sha${name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)}`;
  return { name, commitSHA: defaultSHA };
}

/**
 * Helper function to create multiple GitHubTags from tag names.
 *
 * @param names - Array of tag names
 * @returns Array of GitHubTag objects
 */
export function createMockTags(names: string[]): GitHubTag[] {
  return names.map((name) => createMockTag(name));
}

/**
 * Helper function to create a TerraformModule instance for testing.
 *
 * @param options - Configuration options for the mock module
 * @param options.directory - Required directory path for the module
 * @param options.latestTag - Optional latest tag for the module
 * @param options.commits - Optional array of commit details
 * @param options.commitMessages - Optional array of commit messages (will create commits)
 * @param options.tags - Optional array of tag names (will be converted to GitHubTag objects)
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

  // Convert string tags to GitHubTag objects
  module.setTags(createMockTags(tags));
  module.setReleases(releases);

  return module;
}
