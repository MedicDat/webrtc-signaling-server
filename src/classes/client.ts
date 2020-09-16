export default class Client {
    id = "";
    user_id = "";
    in_call = false;
    session_id = "";

    constructor(part: Partial<Client>) {
        Object.assign(this, part);
    }
}