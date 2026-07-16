import { User } from "../models/user.model.js";
import httpStatus from "http-status";
import bcrypt from "bcrypt";
import crypto from "crypto";


const login = async(req, res) =>{

    const { username, password } = req.body;

    if(!username || !password) {
        return res.status(400).json({message: "Please provide"})
    }

    try {
        const user = await User.findOne({ username });
        if(!user) {
            return res.status(httpStatus.NOT_FOUND).json({message: "User Not Found"})
        }

        let isPasswordCorrect = await bcrypt.compare(password, user.password)
        if(isPasswordCorrect){
            let token = crypto.randomBytes(20).toString("hex");

            user.token = token;
            await user.save();
            return res.status(httpStatus.OK).json({ token: token })
        } else {
            return res.status(httpStatus.UNAUTHORIZED).json({message: "Invalid Username or password"})
        }

    } catch (e) {
        return res.status(500).json({message: `Something went wrong ${e}`})
    }
}


const register = async (req, res) => {
    const { name, username, password} = req.body;

    const trimmedName = (name || "").trim();
    const nameParts = trimmedName.split(/\s+/);
    if (nameParts.length < 2 || !nameParts.every(part => /[a-zA-Z]/.test(part))) {
        return res.status(400).json({message: "Please enter your full name (First Name and Last Name)."});
    }

    if (!password || password.length !== 6) {
        return res.status(400).json({message: "Password must be exactly 6 characters long."});
    }

    try {
        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(httpStatus.FOUND).json({message: "User already exists"});

        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = new User({
            name: name,
            username: username,
            password: hashedPassword,
        });

        await newUser.save();

        res.status(httpStatus.CREATED).json({message: "User Registered Successfully"})

    } catch (e) {
        res.json({message: `Something went wrong ${e}` });
    }
}

export {login, register}