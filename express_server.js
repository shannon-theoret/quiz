const { Pool } = require('pg');

const pool = new Pool({
  user: 'vagrant',
  password: '123',
  host: 'localhost',
  database: 'quizzes'
});

const express = require("express");
const req = require("express/lib/request");
const app = express();
const bodyParser = require("body-parser");
app.use(bodyParser.urlencoded({extended: true}));
const PORT = 8080; // default port 8080
const cookieParser = require('cookie-parser');
const res = require('express/lib/response');
const bcrypt = require('bcryptjs');

app.set("view engine", "ejs");
app.use(cookieParser());

app.listen(PORT, () => {
  console.log(`Example app listening on port ${PORT}!`);
});

app.get("/home", (req, res) => {
  if (req.cookies["user_id"]) {
    const select_quizzes =
      "SELECT quizzes.name AS name, quizzes.url AS url, users.name AS creator_name " +
      "FROM quizzes INNER JOIN users ON quizzes.creator = users.id WHERE quizzes.public = True;"
    pool.query(select_quizzes)
      .then((result) => {
        const quizzes = result.rows;
        const templateVars = {user_name: req.cookies["user_name"], quizzes: quizzes};
        res.render("quiz_home", templateVars);    
      })
      .catch((err) => console.error("query error", err.stack));
  } else {
    res.redirect("/login");
  }
});

app.get("/view", (req, res) => {
  if (req.cookies["user_id"]) {
    const select_quizzes = "SELECT id, name, url, public FROM quizzes WHERE quizzes.creator=$1"
    pool.query(select_quizzes, [req.cookies["user_id"]])
      .then((result) => {
        const quizzes = result.rows;

        const select_users = "SELECT id, name FROM users WHERE id!=$1";
        pool.query(select_users, [req.cookies["user_id"]])
          .then((result) => {
            const users = result.rows;
            const templateVars = {user_name: req.cookies["user_name"], quizzes: quizzes, users: users};
            res.render("quiz_your", templateVars);
          })
          .catch((err) => console.error("query error", err.stack));
            
      })
      .catch((err) => console.error("query error", err.stack));
  } else {
    res.redirect("/login");
  }
});


app.get("/new", (req, res) => {
  if (req.cookies["user_id"]) {
    const templateVars = {user_name: req.cookies["user_name"]}
    res.render("quiz_new", templateVars);
  } else {
    res.redirect("/login");
  }
});

app.post("/new", (req, res) => {
  if (req.cookies["user_id"]) {
    const insert_quizzes = "INSERT INTO quizzes (name, url, public, creator) VALUES ($1, $2, $3, $4) RETURNING id";
    const quizzes_values =[req.body.name, generateRandomString(), req.body.public != undefined, req.cookies.user_id];
    pool.query(insert_quizzes, quizzes_values)
      .then((result) => {
        const quiz_id = result.rows[0].id;
        const insert_question = "INSERT INTO questions (question, answer, quiz_id, question_order) VALUES ($1, $2, $3, $4)"
        let i = 1;
        while(req.body["question" + i]) {
          const question_values = [req.body["question" + i], req.body["answer" + i], quiz_id, i]
          pool.query(insert_question, question_values);
          i++;
        }
      })
      .catch((err) => console.error("query error", err.stack));
  }
  res.redirect("/home");
});

app.get("/quiz/:url", (req, res) => {
  const select_quiz = "SELECT quizzes.id as quiz_id, quizzes.name as quiz_name, users.name as creator FROM quizzes INNER JOIN users ON quizzes.creator = users.id WHERE url=$1";
  pool.query(select_quiz, [req.params.url])
    .then((result) => {
      const quiz_name = result.rows[0].quiz_name;
      const creator = result.rows[0].creator;
      const quiz_id = result.rows[0].quiz_id;

      pool.query("SELECT id, question FROM questions WHERE quiz_id=$1 ORDER BY question_order", [quiz_id])
        .then((result) => {
          const questions = result.rows;
          templateVars = {user_name: req.cookies["user_name"], quiz_id: quiz_id, quiz_name: quiz_name, creator: creator, questions: questions};
          res.render("quiz_take", templateVars);
        })
    })
    .catch((err) => console.error("query error", err.stack));
});

app.get("/shared", (req, res) => {
  pool.query(
    "SELECT quizzes.name AS name, quizzes.url AS url, users.name AS creator_name " +
    "FROM quizzes INNER JOIN users ON quizzes.creator = users.id " +
    "INNER JOIN shared_quizzes ON quizzes.id = shared_quizzes.quiz_id " +
    "WHERE shared_quizzes.user_id=$1", [req.cookies["user_id"]] )
    .then((result) => {
      const quizzes = result.rows;
      const templateVars = {user_name: req.cookies["user_name"], quizzes: quizzes}
      res.render("quiz_shared", templateVars);
    })
    .catch((err) => console.error("query error", err.stack));
})

app.post("/share", (req, res) => {
  pool.query("INSERT INTO shared_quizzes (user_id, quiz_id) VALUES ($1, $2)", [req.body.user_id, req.body.quiz_id])
  .catch((err) => console.error("query error", err.stack))
})

app.post("/attempt", (req, res) => {
  const url = generateRandomString();
  pool.query("INSERT INTO attempts (url, attempter, quiz_id) VALUES ($1, $2, $3) RETURNING id", [url, req.cookies["user_id"], req.body.quiz_id])
  .then((result) => {
    const attempt_id = result.rows[0].id;
    const promises = [];
    pool.query("SELECT id, answer FROM questions WHERE quiz_id=$1", [req.body.quiz_id])
    .then((result) => {
      const insert_answer = "INSERT INTO attempted_questions (answer, correct, question_id, attempt_id) VALUES ($1, $2, $3, $4)";
      result.rows.forEach((row) => {
        promises.push(pool.query(insert_answer, [req.body[row.id], req.body[row.id].localeCompare(row.answer, 'en', { sensitivity: 'base' })===0, row.id, attempt_id]));
      });
      Promise.all(promises)
      .then(
        res.redirect("/result/" + url)
      )
    })
    .catch((err) => console.error("query error", err.stack))
  })  
  .catch((err) => console.error("query error", err.stack))

})

app.get("/attempts", (req, res) => {
  pool.query("SELECT quizzes.name as name, attempts.url as url " +
  "FROM attempts INNER JOIN quizzes ON quizzes.id = attempts.quiz_id " +
  "WHERE attempts.attempter = $1", [req.cookies.user_id])
  .then((result) => {
    const attempts = result.rows;
    const templateVars = {user_name: req.cookies.user_name, attempts: attempts}
    res.render("quiz_attempts", templateVars);
  })
})

app.get("/result/:url", (req, res) => {
  pool.query(
    "SELECT questions.question as question, questions.answer as correct_answer, attempted_questions.answer as answer, attempted_questions.correct as correct " +
    "FROM attempts INNER JOIN attempted_questions ON attempts.id = attempted_questions.attempt_id " +
    "INNER JOIN questions On questions.id = attempted_questions.question_id " +
    "WHERE attempts.url = $1", [req.params.url])
  .then((result) => {
    const results = result.rows;
    const templateVars = {user_name: req.cookies.user_name, results: results}
    res.render("quiz_result", templateVars);
  })
})

app.get("/register", (req, res) => {
  const templateVars = {user_name: req.cookies["user_name"]}
  res.render("quiz_register", templateVars);
});

app.post("/register", (req, res) => {
  const hashedPassword = bcrypt.hashSync(req.body.password, 10);
  const select = "SELECT id, name, email FROM users WHERE email=$1"

  const insert = "INSERT INTO users (name, password, email) VALUES ($1, $2, $3);"
  const values = [req.body.name, hashedPassword, req.body.email];

  pool.query(insert, values)
  .then((result) => {
    pool.query(select, [req.body.email])
      .then((result2) => {
        res.cookie("user_id", result2.rows[0].id);
        res.cookie("user_name", result2.rows[0].name);
        res.redirect("/home");
      })
      .catch((err) => console.error("query error", err.stack));
  }).catch((err) => console.error("query error", err.stack));
})

app.get("/login", (req, res) => {
  const templateVars = {user_name: req.cookies["user_name"], errorMessage: null}
  res.render("quiz_login", templateVars);
})

app.post("/login", (req, res) => {
  const hashedPassword = bcrypt.hashSync(req.body.password, 10);
  const select = "SELECT id, name, email, password FROM users WHERE email=$1";
  pool.query(select, [req.body.email])
    .then((result) => {
        if (result.rowCount === 0) {
          const errorMessage = "There is no user with this email address registered."
          const templateVars = {user_name: req.cookies["user_name"], errorMessage: errorMessage}
          res.render("quiz_login", templateVars)
        } else if (bcrypt.compareSync(result.rows[0].password, req.body.password)) {
          const errorMessage = "The password is incorrect."
          const templateVars = {user_name: req.cookies["user_name"], errorMessage: errorMessage}
          res.render("quiz_login", templateVars)
        } else {
          res.cookie("user_name", result.rows[0].name)
          res.cookie("user_id", result.rows[0].id);
          res.redirect("/home");
        }
    })
    .catch((err) => console.error("query error", err.stack));
});

app.get("/logout", (req, res) => {
  res.clearCookie("user_id");
  res.clearCookie("user_name");
  user = null;
  res.redirect("/home");
});

function generateRandomString() {
  return Math.random().toString(36).replace(/[^a-z]+/g, '')
}