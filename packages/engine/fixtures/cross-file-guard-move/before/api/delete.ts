export async function remove(user: User | undefined, id: string) {
  if (!user) throw new Error("unauthorized");
  await db.delete(id);
}
