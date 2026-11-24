import { expect } from "vitest";

/**
 * A visually hidden file input shows its focus on its visible label: the input is a `peer` just
 * before the label (same parent), which draws the soft focus ring on `peer-focus-visible`.
 */
export function expectLabelShowsFocus(input: HTMLElement): void {
  expect(input).toHaveClass("peer");
  const label = input.parentElement?.querySelector(`label[for="${input.id}"]`);
  expect(label).not.toBeNull();
  expect(
    input.compareDocumentPosition(label as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(label).toHaveClass("peer-focus-visible:ring-[0.1875rem]");
}
