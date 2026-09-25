export async function read(user: User | undefined, id: string) {
  if (!user) throw new Error("unauthorized");
  return db.get(id);
}
