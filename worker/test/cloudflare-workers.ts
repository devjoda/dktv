// Stands in for the module Workers have, which Node doesn't
export class DurableObject<Env = unknown> {
	constructor(protected ctx: DurableObjectState, protected env: Env) {}
}
