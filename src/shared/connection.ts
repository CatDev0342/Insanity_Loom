// How Insanity_Loom reaches the assistant: every option, the defaults, and the exact command they produce. Shared by
// the layer underneath, which runs the command, and the Connection Settings panel, which shows it — so what the
// panel shows is always exactly what will run.

/**
 * Where the assistant runs.
 * - docker: in a Docker container on this computer; Insanity_Loom runs the host inside it with `docker exec`.
 * - local: on this computer directly; Insanity_Loom runs the host itself.
 * Either way the host speaks the Agent Client Protocol over its standard input and output.
 */
export type AssistantPlace = 'docker' | 'local';

export interface ConnectionSettings {
  readonly place: AssistantPlace;
  /** The Docker program: "docker" to find it on the PATH, or its full path. Used when place is docker. */
  readonly dockerProgram: string;
  /** The running container's name or id. Used when place is docker. */
  readonly container: string;
  /** The user to run the host as inside the container; '' for the container's own default user. */
  readonly containerUser: string;
  /** The folder the assistant works in — inside the container, or on this computer. Conversations belong to it. */
  readonly workingFolder: string;
  /** The program that starts the assistant host (inside the container, or on this computer). */
  readonly hostProgram: string;
  /** The host program's arguments, one per entry. */
  readonly hostArguments: readonly string[];
  /** How long the host may take to answer the first handshake before Insanity_Loom gives up, in seconds. */
  readonly handshakeSeconds: number;
  /** Whether Insanity_Loom connects by itself when it starts. */
  readonly connectOnStart: boolean;
}

// What a new Insanity_Loom starts with. Nothing here describes anyone's own setup: where the assistant runs is the
// author's to fill in, the first time, in Assistant ▸ Connection Settings, which opens by itself until it is done.
// Their answers are kept only in their own Data folder.
export const DEFAULT_CONNECTION: ConnectionSettings = {
  place: 'docker',
  dockerProgram: 'docker',
  container: '',
  containerUser: '',
  workingFolder: '',
  hostProgram: '',
  hostArguments: [],
  handshakeSeconds: 90,
  connectOnStart: true,
};

// The handshake limit's range, in seconds: long enough for a cold container, short enough to notice a dead one.
export const SHORTEST_HANDSHAKE_SECONDS = 5;
export const LONGEST_HANDSHAKE_SECONDS = 600;

/** The command Insanity_Loom runs to start the host: the program, its arguments, and the folder to run it in. */
export interface HostCommand {
  readonly program: string;
  readonly args: readonly string[];
  /** The folder to start the program in, on this computer; undefined when Docker places it instead. */
  readonly cwd: string | undefined;
}

/** Something to run with the host program instead of the host itself: more arguments, and environment variables. */
export interface HostVariant {
  /** Added after the host's own arguments (a sign-in method's, say). */
  readonly extraArguments: readonly string[];
  /**
   * Environment variables the program needs. Inside a container they are passed by name alone (`-e NAME`), so
   * Docker takes each value from Insanity_Loom's own environment and it never appears in the command line.
   */
  readonly environmentNames: readonly string[];
}

const NO_VARIANT: HostVariant = { extraArguments: [], environmentNames: [] };

export function hostCommand(settings: ConnectionSettings, variant: HostVariant = NO_VARIANT): HostCommand {
  const hostArguments = [...settings.hostArguments, ...variant.extraArguments];
  if (settings.place === 'docker') {
    // -i keeps the host's input open: the protocol travels on it. -w sets the folder inside the container.
    const user = settings.containerUser.trim() === '' ? [] : ['-u', settings.containerUser];
    const environment = variant.environmentNames.flatMap((name) => ['-e', name]);
    return {
      program: settings.dockerProgram,
      args: ['exec', '-i', ...user, ...environment, '-w', settings.workingFolder, settings.container, settings.hostProgram, ...hostArguments],
      cwd: undefined,
    };
  }
  return { program: settings.hostProgram, args: hostArguments, cwd: settings.workingFolder };
}

/** The command as one line, the way it would be typed, for showing to the author. */
export function describeCommand(command: HostCommand): string {
  const quote = (word: string): string => (/^[\w@%+=:,./\\-]+$/.test(word) ? word : `"${word.replace(/"/g, '\\"')}"`);
  return [command.program, ...command.args].map(quote).join(' ');
}

/** Where the assistant runs, as the end of a sentence ("Connected to Claude Agent …"). */
export function describePlace(settings: ConnectionSettings): string {
  return settings.place === 'docker' ? `in the Docker container "${settings.container}"` : 'on this computer';
}

/** Everything wrong with a set of connection settings, in words for the author; empty when they can be used. */
export function connectionProblems(settings: ConnectionSettings): string[] {
  const problems: string[] = [];
  const blank = (value: string): boolean => value.trim() === '';
  if (settings.place === 'docker') {
    if (blank(settings.dockerProgram)) problems.push('The Docker program must be named: "docker", or its full path.');
    if (blank(settings.container)) problems.push('The container must be named.');
  }
  if (blank(settings.workingFolder)) problems.push('The working folder must be named.');
  if (blank(settings.hostProgram)) problems.push('The host program must be named.');
  if (settings.hostArguments.some(blank)) problems.push('A host argument is empty; remove the blank line.');
  if (
    !Number.isInteger(settings.handshakeSeconds) ||
    settings.handshakeSeconds < SHORTEST_HANDSHAKE_SECONDS ||
    settings.handshakeSeconds > LONGEST_HANDSHAKE_SECONDS
  ) {
    problems.push(`The handshake time limit must be a whole number of seconds from ${SHORTEST_HANDSHAKE_SECONDS} to ${LONGEST_HANDSHAKE_SECONDS}.`);
  }
  return problems;
}
