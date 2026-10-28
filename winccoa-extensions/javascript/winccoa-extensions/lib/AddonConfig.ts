interface SubprojectConfig {
  // Optional for addons in the WinCC OA installation directory (preinstalled addons),
  // whose subproject name defaults to the addon's folder name.
  // Still required for addons from external sources (git repositories),
  // since a single repository may contain multiple subprojects.
  Name?: string;
  Description?: string;
  Managers?: ManagerConfig[];
  Dplists?: string[];
  UpdateScripts?: string[];
  UninstallScripts?: string[];
  DbUpdateScripts?: string[];
  DependentManagers?: DependentManagerConfig[];
}

/** A SubprojectConfig whose Name is guaranteed to be set */
interface NamedSubprojectConfig extends SubprojectConfig {
  Name: string;
}

interface AddonConfig {
  RepoName: string;
  Keywords: string[];
  Version: string;
  Description: string;
  OaVersion: string;
  Subprojects: SubprojectConfig[];
  Dependencies?: string[];
}

interface ManagerConfig {
  Name: string;
  StartMode: StartMode;
  Options: string;
  RestartOnUpdate?: boolean;
}

interface DependentManagerConfig {
  Name: string;
  Options?: string;
}

enum StartMode {
  Always = "always",
  Manual = "manual",
  Once = "once",
  Unknown = "",
}

export {
  AddonConfig,
  SubprojectConfig,
  NamedSubprojectConfig,
  ManagerConfig,
  DependentManagerConfig,
  StartMode,
};
