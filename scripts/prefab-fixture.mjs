// Independent Unity text fixture writer. Node parents are array indices.
export function prefabText(nodes) {
  const header = "%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n";
  const xyz = (values) => `{x: ${values[0]}, y: ${values[1]}, z: ${values[2]}}`;
  return (
    header +
    nodes
      .map((node, i) => {
        const go = 1000 + i,
          transform = 4000 + i,
          filter = 33000 + i,
          renderer = 23000 + i;
        const children = nodes.flatMap((child, j) =>
          child.parent === i ? [4000 + j] : [],
        );
        const rotation = node.rotation ?? [0, 0, 0, 1];
        return `--- !u!1 &${go}
GameObject:
  m_Name: ${JSON.stringify(node.name ?? "Node" + i)}
  m_IsActive: ${node.active === false ? 0 : 1}
  m_Component:
  - component: {fileID: ${transform}}
${node.mesh ? `  - component: {fileID: ${filter}}\n  - component: {fileID: ${renderer}}\n` : ""}--- !u!4 &${transform}
Transform:
  m_GameObject: {fileID: ${go}}
  m_LocalPosition: ${xyz(node.position ?? [0, 0, 0])}
  m_LocalRotation: {x: ${rotation[0]}, y: ${rotation[1]}, z: ${rotation[2]}, w: ${rotation[3]}}
  m_LocalScale: ${xyz(node.scale ?? [1, 1, 1])}
  m_Father: {fileID: ${node.parent === undefined ? 0 : 4000 + node.parent}}
  m_Children:${children.length ? "\n" + children.map((id) => `  - {fileID: ${id}}`).join("\n") : " []"}
${
  node.mesh
    ? `--- !u!33 &${filter}
MeshFilter:
  m_GameObject: {fileID: ${go}}
  m_Mesh: {fileID: ${node.mesh.fileID}, guid: ${node.mesh.guid}, type: 3}
--- !u!23 &${renderer}
MeshRenderer:
  m_GameObject: {fileID: ${go}}
  m_Enabled: ${node.enabled === false ? 0 : 1}
  m_Materials:
${(node.materials ?? []).map((guid) => `  - {fileID: 2100000, guid: ${guid}, type: 2}`).join("\n")}
`
    : ""
}`;
      })
      .join("")
  );
}
