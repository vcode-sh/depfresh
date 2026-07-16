const PACKAGE_NAME = /^(?:@[a-z0-9~][a-z0-9._~-]*\/)?[a-z0-9~][a-z0-9._~-]*$/u

export function isValidPackageName(name: string): boolean {
  return PACKAGE_NAME.test(name)
}
