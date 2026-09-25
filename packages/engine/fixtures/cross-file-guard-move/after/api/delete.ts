export async function remove(user: User | undefined, id: string) {
  await db.delete(id);
}
