import type { PbxprojSettingChange, PbxprojSummary } from "@hihyou/engine";
import { createSignal, type JSX } from "solid-js";
import { pbxprojLabels } from "../pbxproj.js";

interface Props {
  summary: PbxprojSummary;
  source: () => JSX.Element;
}

export const PbxprojPanel = (props: Props): JSX.Element => {
  const [view, setView] = createSignal<"summary" | "source">("summary");
  const groups = () => settingGroups(props.summary.settings);
  return (
    <div class="hh-pbxproj">
      <nav class="hh-pbxproj-tabs" aria-label="Xcode project diff view">
        <button
          type="button"
          class="hh-button"
          classList={{ "hh-pbxproj-tab-active": view() === "summary" }}
          aria-pressed={view() === "summary"}
          on:click={() => setView("summary")}
        >
          {pbxprojLabels.views[0]}
        </button>
        <span aria-hidden="true">|</span>
        <button
          type="button"
          class="hh-button"
          classList={{ "hh-pbxproj-tab-active": view() === "source" }}
          aria-pressed={view() === "source"}
          on:click={() => setView("source")}
        >
          {pbxprojLabels.views[1]}
        </button>
      </nav>
      <div class="hh-pbxproj-summary" hidden={view() !== "summary"}>
        {props.summary.addedProject ? (
          <details class="hh-pbxproj-new">
            <summary>{countsText(props.summary.addedProject)}</summary>
            <dl>
              <div>
                <dt>Targets</dt>
                <dd>{props.summary.addedProject.targets}</dd>
              </div>
              <div>
                <dt>Files</dt>
                <dd>{props.summary.addedProject.files}</dd>
              </div>
              <div>
                <dt>Settings</dt>
                <dd>{props.summary.addedProject.settings}</dd>
              </div>
            </dl>
          </details>
        ) : (
          <>
            <section>
              <h3>{pbxprojLabels.sections[0]}</h3>
              {props.summary.files.length === 0 ? (
                <p class="hh-pbxproj-empty">No changes</p>
              ) : (
                <ul>
                  {props.summary.files.map((file) => (
                    <li class={changeClass(file.kind)}>
                      <span class="hh-pbxproj-sign" aria-hidden="true">
                        {file.kind === "added" ? "+" : "−"}
                      </span>{" "}
                      <code>{file.path}</code>
                      {file.target && (
                        <>
                          {" "}
                          → {file.target}
                          {file.phase && <> · {file.phase}</>}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3>{pbxprojLabels.sections[1]}</h3>
              {props.summary.packages.length === 0 ? (
                <p class="hh-pbxproj-empty">No changes</p>
              ) : (
                <ul>
                  {props.summary.packages.map((item) => (
                    <li class={changeClass(item.kind)}>
                      <span class="hh-pbxproj-sign" aria-hidden="true">
                        {item.kind === "added" ? "+" : "−"}
                      </span>{" "}
                      <strong>{item.name}</strong>
                      {item.url && (
                        <>
                          {" "}
                          · <code>{item.url}</code>
                        </>
                      )}
                      {item.requirement && <> · {item.requirement}</>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3>{pbxprojLabels.sections[2]}</h3>
              {props.summary.targets.length === 0 ? (
                <p class="hh-pbxproj-empty">No changes</p>
              ) : (
                <ul>
                  {props.summary.targets.map((item) => (
                    <li class={changeClass(item.kind)}>
                      <span class="hh-pbxproj-sign" aria-hidden="true">
                        {item.kind === "added" ? "+" : "−"}
                      </span>{" "}
                      {item.target}
                      {item.phase && <> · {item.phase}</>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3>{pbxprojLabels.sections[3]}</h3>
              {groups().length === 0 ? (
                <p class="hh-pbxproj-empty">No changes</p>
              ) : (
                groups().map((group) => (
                  <div
                    class="hh-pbxproj-settings"
                    role="region"
                    aria-label={`${group.target}, ${group.configuration} build settings`}
                    tabIndex={0}
                  >
                    <h4>
                      {group.target} · {group.configuration}
                    </h4>
                    <SettingTable
                      changes={group.changes}
                      caption={`${group.target} · ${group.configuration}`}
                    />
                  </div>
                ))
              )}
            </section>
            <section>
              <h3>{pbxprojLabels.sections[4]}</h3>
              {props.summary.noise.length === 0 ? (
                <p class="hh-pbxproj-empty">No changes</p>
              ) : (
                <details>
                  <summary>{`${props.summary.noise.length} shape-only ${props.summary.noise.length === 1 ? "change" : "changes"}`}</summary>
                  <SettingTable
                    changes={props.summary.noise}
                    caption="Shape-only build setting changes"
                  />
                </details>
              )}
            </section>
          </>
        )}
      </div>
      <div hidden={view() !== "source"}>{props.source()}</div>
    </div>
  );
};

const SettingTable = (props: {
  changes: PbxprojSettingChange[];
  caption: string;
}): JSX.Element => (
  <table class="hh-pbxproj-table">
    <caption class="hh-sr">{props.caption}</caption>
    <thead>
      <tr>
        <th scope="col">Setting</th>
        <th scope="col">Before</th>
        <th scope="col">After</th>
      </tr>
    </thead>
    <tbody>
      {props.changes.map((change) => (
        <tr>
          <th scope="row">
            <code>{change.key}</code>
          </th>
          <td>
            <code>{change.before}</code>
          </td>
          <td>
            <code>{change.after}</code>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

const settingGroups = (settings: PbxprojSettingChange[]) => {
  const groups = new Map<
    string,
    { target: string; configuration: string; changes: PbxprojSettingChange[] }
  >();
  for (const setting of settings) {
    const key = `${setting.target}\0${setting.configuration}`;
    const group = groups.get(key) ?? {
      target: setting.target,
      configuration: setting.configuration,
      changes: [],
    };
    group.changes.push(setting);
    groups.set(key, group);
  }
  return [...groups.values()];
};

const changeClass = (kind: "added" | "removed") =>
  kind === "added" ? "hh-pbxproj-added" : "hh-pbxproj-removed";

const countsText = (counts: {
  targets: number;
  files: number;
  settings: number;
}) =>
  `${counts.targets} ${counts.targets === 1 ? "target" : "targets"} · ${counts.files} ${counts.files === 1 ? "file" : "files"} · ${counts.settings} ${counts.settings === 1 ? "setting" : "settings"}`;
